import { getDb, listJourneys } from "@/lib/server/db"
import { ensureSeeded } from "@/lib/server/seed"
import { handle, json } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handle(async () => {
  const db = getDb()
  ensureSeeded(db)
  return json({ data: listJourneys(db) })
})