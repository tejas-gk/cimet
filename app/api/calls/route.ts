import { getDb, listCalls, listJourneys } from "@/lib/server/db"
import { ensureSeeded } from "@/lib/server/seed"
import { handle, json } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handle(async () => {
  const db = getDb()
  ensureSeeded(db)
  const calls = listCalls(db)
  const journeys = listJourneys(db)
  const journeyById = new Map(journeys.map((j) => [j.id, j]))
  return json({
    data: calls.map((call) => ({
      ...call,
      journey: journeyById.get(call.journeyId) ?? null,
    })),
  })
})