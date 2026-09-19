import { getDb, createUtterance, listCalls } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"
import { speechToText } from "@/lib/server/sarvam"
import { handoffForCall } from "@/lib/server/handoff-queue"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(
  async (req: Request, ctx: RouteContext<"/api/calls/[id]/human-turn">) => {
    const { id } = await ctx.params
    const body = (await req.json().catch(() => null)) as {
      text?: string
      audioBase64?: string
    } | null

    const db = getDb()
    const call = listCalls(db).find((c) => c.id === id) ?? null
    if (!call) return apiError("Call not found", 404, "not_found")

    const handoff = handoffForCall(db, id)
    if (!handoff || handoff.status !== "accepted") {
      return apiError(
        "This call is not in an active human takeover",
        409,
        "not_accepted"
      )
    }

    let text = body?.text?.trim() ?? ""
    if (body?.audioBase64) {
      const audio = Buffer.from(body.audioBase64, "base64")
      if (audio.length === 0) {
        return apiError("Empty audio received", 400, "empty_audio")
      }
      const stt = await speechToText({ audio, filename: "human-turn.wav" })
      text = stt.transcript.trim()
    }
    if (!text) {
      return apiError("Provide either text or audioBase64", 400, "empty_turn")
    }

    const last = call.utterances[call.utterances.length - 1]
    const startMs = last ? last.endMs + 500 : 0
    createUtterance(db, {
      id: crypto.randomUUID(),
      callId: id,
      speaker: "human-agent",
      text,
      startMs,
      endMs: startMs + Math.max(1800, text.length * 45),
    })

    const updated = listCalls(db).find((c) => c.id === id) ?? null
    return json({ data: { call: updated } })
  }
)