import { getDb } from "@/lib/server/db"
import { endCallSilently } from "@/lib/server/voice-agent"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Gracefully end a live call after a long customer pause — the agent
 * acknowledges the silence, wraps up politely and stops. The post-call AI
 * Quality Auditor runs on the full conversation automatically.
 */
export const POST = handle(
  async (_req: Request, ctx: RouteContext<"/api/calls/[id]/end">) => {
    const { id } = await ctx.params
    const db = getDb()
    try {
      const result = await endCallSilently(db, id)
      return json({ data: result })
    } catch (error) {
      if (error instanceof Error && error.message === "Call not found") {
        return apiError("Call not found", 404, "not_found")
      }
      throw error
    }
  }
)
