import { getDb, listAudits } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/audits/[id]">) => {
  const { id } = await ctx.params
  const db = getDb()
  const audit = listAudits(db).find((a) => a.id === id)
  if (!audit) return apiError("Audit not found", 404, "not_found")
  return json({ data: audit })
})