import {
  demoScenarios,
  synthesizeDemoRecording,
  SYNC_STT_MAX_SECONDS,
} from "@/lib/server/demo-recording"
import { runAudit } from "@/lib/server/auditor"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type GenerateBody = {
  scenario?: string
}

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as GenerateBody | null
  const scenarioId = body?.scenario ?? "all"

  const targets =
    scenarioId === "all"
      ? demoScenarios
      : demoScenarios.filter((s) => s.id === scenarioId)
  if (targets.length === 0) {
    return apiError(
      `Unknown scenario '${scenarioId}'`,
      400,
      "unknown_scenario"
    )
  }

  const results = []
  for (const scenario of targets) {
    const { audio, durationMs } = await synthesizeDemoRecording(scenario)
    if (durationMs > SYNC_STT_MAX_SECONDS * 1000) {
      return apiError(
        `Scenario '${scenario.id}' produced a ${Math.round(durationMs / 1000)}s recording, over the ${SYNC_STT_MAX_SECONDS}s synchronous-STT cap. Shorten its script.`,
        400,
        "audio_too_long"
      )
    }
    const { audit } = await runAudit({
      audio,
      source: "generated-demo",
      persistAudio: true,
      attributes: {
        leadName: scenario.leadName,
        agentName: scenario.agentName,
        retailer: scenario.retailer,
        customerEmail: scenario.customerEmail,
        ...scenario.facts,
      },
    })
    results.push({ scenario: scenario.id, audit })
  }

  return json({
    data: results.map((r) => r.audit),
    message: `Generated ${results.length} real test recording${results.length === 1 ? "" : "s"} and ran the live audit pipeline.`,
  })
})