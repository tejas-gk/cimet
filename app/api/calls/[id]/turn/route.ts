import { getDb } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"
import { processTurn } from "@/lib/server/voice-agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type TurnBody = {
  text?: string
  audioBase64?: string
}

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/calls/[id]/turn">) => {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as TurnBody | null
  if (!body) return apiError("Invalid request body", 400, "invalid_body")

  const text = body.text?.trim() ?? ""
  const audio = body.audioBase64 ?? ""
  if (!text && !audio) {
    return apiError("Provide either text or audioBase64", 400, "missing_input")
  }
  if (text && audio) {
    return apiError("Provide either text or audioBase64, not both", 400, "invalid_body")
  }

  const db = getDb()
  try {
    const result = await processTurn(
      text
        ? { db, callId: id, text }
        : { db, callId: id, audioBase64: audio }
    )
    return json({ data: result })
  } catch (error) {
    if (error instanceof Error && error.message === "Call not found") {
      return apiError("Call not found", 404, "not_found")
    }
    throw error
  }
})