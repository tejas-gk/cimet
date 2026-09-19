import { getDb, listCalls, getJourney } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handle(
  async (_req: Request, ctx: RouteContext<"/api/calls/[id]">) => {
    const { id } = await ctx.params
    const db = getDb()
    const call = listCalls(db).find((c) => c.id === id)
    if (!call) return apiError("Call not found", 404, "not_found")
    const journey = getJourney(db, call.journeyId)
    return json({ data: { ...call, journey } })
  }
)
