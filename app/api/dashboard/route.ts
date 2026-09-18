import { getDb, dashboardMetrics } from "@/lib/server/db"
import { handle, json } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handle(async () => {
  const db = getDb()
  return json({ data: dashboardMetrics(db) })
})