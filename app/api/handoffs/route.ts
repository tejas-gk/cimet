import { getDb } from "@/lib/server/db"
import { handle, json } from "@/lib/server/http"
import { listHandoffQueue } from "@/lib/server/handoff-queue"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handle(async () => {
  const queue = listHandoffQueue(getDb())
  return json({ data: queue })
})