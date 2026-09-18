import type {
  PhoneDialResult,
  PhoneProvider,
  PhoneTurnResult,
} from "@/lib/server/phone/types"
import {
  auditManagedRecording,
  getCallAndJourney,
  markDialEnded,
  markDialStarted,
  requiredProviderEnv,
} from "@/lib/server/phone/managed"

type RetellCallResponse = {
  call_id?: string
  callId?: string
}

function authHeader() {
  return { Authorization: `Bearer ${requiredProviderEnv("RETELL_API_KEY")}` }
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function retellCallId(payload: RetellCallResponse) {
  return payload.call_id ?? payload.callId ?? ""
}

export const retellPhoneProvider: PhoneProvider = {
  id: "retell",

  async dial(db, callId): Promise<PhoneDialResult> {
    const { journey } = getCallAndJourney(db, callId)
    const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from_number: requiredProviderEnv("RETELL_FROM_NUMBER"),
        to_number: journey.phone,
        agent_id: requiredProviderEnv("RETELL_AGENT_ID"),
        metadata: {
          callId,
          journeyId: journey.id,
          customerName: journey.customerName,
        },
      }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Retell call failed (${res.status}): ${text}`)
    const payload = JSON.parse(text) as RetellCallResponse
    return {
      provider: this.id,
      providerCallId: retellCallId(payload),
      call: markDialStarted(db, callId),
    }
  },

  async initialTwiml(): Promise<string> {
    throw new Error("Retell manages the live phone conversation")
  },

  async turnTwiml(): Promise<PhoneTurnResult> {
    throw new Error("Retell manages the live phone conversation")
  },

  async status(db, callId, form): Promise<void> {
    const status = String(form.get("call_status") ?? form.get("status") ?? "")
    if (["ended", "completed", "done"].includes(status))
      markDialEnded(db, callId, "completed")
    if (["error", "failed", "not_connected", "no_answer"].includes(status))
      markDialEnded(db, callId, "declined")
  },

  async recording(db, callId, form) {
    const rawPayload = getString(form.get("payload"))
    const payload = rawPayload
      ? (JSON.parse(rawPayload) as Record<string, unknown>)
      : null
    const callPayload = getRecord(payload?.call)
    const recordingUrl =
      getString(form.get("recording_url")) ||
      getString(payload?.recording_url) ||
      getString(payload?.recordingUrl) ||
      getString(callPayload.recording_url)
    if (!recordingUrl) return null
    markDialEnded(db, callId, "completed")
    return auditManagedRecording(db, callId, recordingUrl, authHeader())
  },
}
