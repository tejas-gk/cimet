import { AuditError, runAudit } from "@/lib/server/auditor"
import { handle, json, apiError } from "@/lib/server/http"
import { inspectWav } from "@/lib/server/wav"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_AUDIO_SECONDS = 30

export const POST = handle(async (req: Request) => {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return apiError("Expected multipart/form-data", 400, "invalid_form")
  }

  const file = form.get("file")
  if (!(file instanceof File)) {
    return apiError("Missing audio file under the 'file' field", 400, "missing_file")
  }
  const str = (key: string) => String(form.get(key) ?? "").trim()
  const retailer = str("retailer")
  const agentName = str("agentName")
  const leadName = str("leadName")
  const customerEmail = str("customerEmail") || undefined
  const leadId = str("leadId") || undefined

  if (!retailer || !agentName || !leadName) {
    return apiError(
      "retailer, agentName and leadName are required",
      400,
      "missing_metadata"
    )
  }

  const audio = Buffer.from(await file.arrayBuffer())
  if (audio.length === 0) return apiError("Empty audio file", 400, "empty_audio")

  // Synchronous STT is designed for short files; flag obvious overage.
  try {
    const info = inspectWav(audio)
    const seconds = info.pcmLength / (info.sampleRate * info.bitsPerSample / 8) / info.channelCount
    if (seconds > MAX_AUDIO_SECONDS) {
      return apiError(
        `Recording is too long for synchronous transcription (${Math.round(seconds)}s > ${MAX_AUDIO_SECONDS}s). Trim it under ${MAX_AUDIO_SECONDS} seconds.`,
        400,
        "audio_too_long"
      )
    }
  } catch {
    // Not a WAV — the STT API supports many codecs; let its own errors surface.
  }

  const result = await runAudit({
    audio,
    source: "upload",
    persistAudio: true,
    leadId,
    attributes: {
      leadName,
      agentName,
      retailer,
      planId: str("planId") || undefined,
      customerEmail,
      address: str("address") || undefined,
      postcode: str("postcode") || undefined,
      dob: str("dob") || undefined,
      fuelType: str("fuelType") || undefined,
      nmiMirn: str("nmiMirn") || undefined,
      concession: str("concession") || undefined,
      lifeSupport: str("lifeSupport") || undefined,
      moveInDate: str("moveInDate") || undefined,
    },
  })

  return json({ data: result.audit, transcript: result.transcript })
})