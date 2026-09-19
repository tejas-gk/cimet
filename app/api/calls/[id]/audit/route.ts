import { getDb, listAudits } from "@/lib/server/db"
import { runCallAudit } from "@/lib/server/call-audit"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Quality audit for a live AI voice-agent call. GET returns the audit that was
 * already produced for the call (404 if none yet); POST forces the full
 * conversation through the AI Quality Auditor right now.
 */
export const GET = handle(
  async (_req: Request, ctx: RouteContext<"/api/calls/[id]/audit">) => {
    const { id } = await ctx.params
    const db = getDb()
    const callAudit = listAudits(db).find((a) => a.leadId === id) ?? null
    if (!callAudit)
      return apiError("No audit for this call yet", 404, "not_found")
    return json({ data: callAudit })
  }
)

export const POST = handle(
  async (_req: Request, ctx: RouteContext<"/api/calls/[id]/audit">) => {
    const { id } = await ctx.params
    const db = getDb()
    try {
      const audit = await runCallAudit(db, id)
      if (!audit) {
        return apiError(
          "This call could not be audited (too short, or the conversation is over the synchronous transcription limit)",
          422,
          "unprocessable"
        )
      }
      return json({ data: audit })
    } catch (error) {
      if (error instanceof Error && error.message === "Call not found") {
        return apiError("Call not found", 404, "not_found")
      }
      throw error
    }
  }
)
