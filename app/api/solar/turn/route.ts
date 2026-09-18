import { handle, json, apiError } from "@/lib/server/http"
import { processSolarTurn } from "@/lib/server/solar-agent"
import type { SolarConversationLine } from "@/lib/server/solar-agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_SPEAKERS = new Set(["user", "ai", "human-agent"])

type TurnBody = {
  text?: string
  audioBase64?: string
  history?: Array<{ speaker?: string; text?: string }>
  humanAgent?: boolean
}

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as TurnBody | null
  if (!body) return apiError("Invalid request body", 400, "invalid_body")

  const text = body.text?.trim() ?? ""
  const audio = body.audioBase64 ?? ""
  if (!text && !audio) {
    return apiError("Provide either text or audioBase64", 400, "missing_input")
  }
  if (text && audio) {
    return apiError(
      "Provide either text or audioBase64, not both",
      400,
      "invalid_body"
    )
  }

  const history: SolarConversationLine[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (item) =>
            item &&
            typeof item.speaker === "string" &&
            VALID_SPEAKERS.has(item.speaker) &&
            typeof item.text === "string"
        )
        .slice(-20)
        .map((item) => ({
          speaker: item.speaker as SolarConversationLine["speaker"],
          text: String(item.text).slice(0, 2000),
        }))
    : []

  const result = await processSolarTurn({
    text: text || undefined,
    audioBase64: audio || undefined,
    history,
    humanAgent: !!body.humanAgent,
  })

  return json({ data: result })
})
