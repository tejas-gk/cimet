import { getDb } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"
import { startCall } from "@/lib/server/voice-agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(
  async (_req: Request, ctx: RouteContext<"/api/calls/[id]/start">) => {
    const { id } = await ctx.params
    const db = getDb()
    try {
      const result = await startCall(db, id)
      return json({ data: result })
    } catch (error) {
      if (error instanceof Error && error.message === "Call not found") {
        return apiError("Call not found", 404, "not_found")
      }
      throw error
    }
  }
)
