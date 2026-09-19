import { getDb, listHumanAgents, listCalls } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"
import {
  acceptHandoff,
  completeHandoff,
  convertToCallback,
  handoffForCall,
  listHandoffQueue,
  releaseHandoff,
} from "@/lib/server/handoff-queue"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIONS = ["accept", "complete", "release", "callback"] as const

export const POST = handle(
  async (req: Request, ctx: RouteContext<"/api/handoffs/[id]">) => {
    const { id } = await ctx.params
    const body = (await req.json().catch(() => null)) as {
      action?: string
      agentId?: string
    } | null
    const action = body?.action ?? ""
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return apiError(
        `Invalid action — expected one of ${ACTIONS.join(", ")}`,
        400,
        "invalid_action"
      )
    }

    const db = getDb()
    try {
      if (action === "accept") {
        if (!body?.agentId) {
          return apiError("agentId is required to accept a handoff", 400, "missing_agent")
        }
        acceptHandoff(db, id, body.agentId)
      } else if (action === "complete") {
        await completeHandoff(db, id)
      } else if (action === "release") {
        releaseHandoff(db, id)
      } else if (action === "callback") {
        convertToCallback(db, id)
      }
      return json({
        data: {
          handoff: handoffForCall(db, id),
          call: listCalls(db).find((c) => c.id === id) ?? null,
          queue: listHandoffQueue(db),
          agents: listHumanAgents(db),
        },
      })
    } catch (error) {
      if (error instanceof Error) {
        return apiError(error.message, 400, "handoff_error")
      }
      throw error
    }
  }
)