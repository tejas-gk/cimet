import { getDb, listAudits, overrideAudit } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type OverrideBody = {
  verdict?: "auto-pass" | "hold" | "human-review"
  note?: string
}

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/audits/[id]/override">) => {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as OverrideBody | null
  if (!body || !body.verdict) {
    return apiError("Provide a verdict (auto-pass | hold | human-review)", 400, "invalid_body")
  }
  if (!["auto-pass", "hold", "human-review"].includes(body.verdict)) {
    return apiError("verdict must be auto-pass, hold or human-review", 400, "invalid_verdict")
  }

  const db = getDb()
  const audit = listAudits(db).find((a) => a.id === id)
  if (!audit) return apiError("Audit not found", 404, "not_found")

  overrideAudit(db, id, body.verdict, body.note ?? "")
  const updated = listAudits(db).find((a) => a.id === id)
  return json({ data: updated })
})