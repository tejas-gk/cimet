import { handle, json } from "@/lib/server/http"
import { SOLAR_GREETING, synthesizeGreeting } from "@/lib/server/solar-agent"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(async () => {
  const audioBase64 = await synthesizeGreeting()
  return json({
    data: {
      turn: { speaker: "ai", text: SOLAR_GREETING, audioBase64 },
    },
  })
})
