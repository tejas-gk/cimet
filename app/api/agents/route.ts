import { getDb, listHumanAgents, setHumanAgentStatus } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"
import { setAgentStatus } from "@/lib/server/handoff-queue"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = handle(async () => {
  return json({ data: listHumanAgents(getDb()) })
})

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as {
    agentId?: string
    status?: string
  } | null
  const agentId = body?.agentId ?? ""
  const status = body?.status ?? ""
  if (!agentId) return apiError("agentId is required", 400, "missing_agent")
  if (!["online", "away"].includes(status)) {
    return apiError("status must be 'online' or 'away'", 400, "invalid_status")
  }

  const db = getDb()
  try {
    setAgentStatus(db, agentId, status as "online" | "away")
    return json({
      data: { agentId, status, isSet: true },
    })
  } catch (error) {
    if (error instanceof Error && error.message === "Agent not found") {
      return apiError("Agent not found", 404, "not_found")
    }
    throw error
  }
})

export const PATCH = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as {
    id?: string
    status?: string
  } | null
  const id = body?.id ?? ""
  const status = body?.status ?? ""
  if (!id) return apiError("id is required", 400, "missing_agent")
  if (!["online", "away", "busy"].includes(status)) {
    return apiError(
      "status must be 'online', 'away' or 'busy'",
      400,
      "invalid_status"
    )
  }

  const db = getDb()
  try {
    if (status === "busy") {
      setHumanAgentStatus(db, id, "busy")
    } else {
      setAgentStatus(db, id, status as "online" | "away")
    }
    return json({ data: listHumanAgents(db) })
  } catch (error) {
    if (error instanceof Error && error.message === "Agent not found") {
      return apiError("Agent not found", 404, "not_found")
    }
    throw error
  }
})