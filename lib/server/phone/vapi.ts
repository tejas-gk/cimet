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

type VapiCallResponse = {
  id?: string
}

function authHeader() {
  return { Authorization: `Bearer ${requiredProviderEnv("VAPI_API_KEY")}` }
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

export const vapiPhoneProvider: PhoneProvider = {
  id: "vapi",

  async dial(db, callId): Promise<PhoneDialResult> {
    const { journey } = getCallAndJourney(db, callId)
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        ...authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phoneNumberId: requiredProviderEnv("VAPI_PHONE_NUMBER_ID"),
        assistantId: requiredProviderEnv("VAPI_ASSISTANT_ID"),
        customer: { number: journey.phone, name: journey.customerName },
        metadata: {
          callId,
          journeyId: journey.id,
          retailer: journey.retailer,
        },
      }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`Vapi call failed (${res.status}): ${text}`)
    const payload = JSON.parse(text) as VapiCallResponse
    return {
      provider: this.id,
      providerCallId: payload.id ?? "",
      call: markDialStarted(db, callId),
    }
  },

  async initialTwiml(): Promise<string> {
    throw new Error("Vapi manages the live phone conversation")
  },

  async turnTwiml(): Promise<PhoneTurnResult> {
    throw new Error("Vapi manages the live phone conversation")
  },

  async status(db, callId, form): Promise<void> {
    const status = String(form.get("status") ?? form.get("endedReason") ?? "")
    if (["ended", "completed"].includes(status))
      markDialEnded(db, callId, "completed")
    if (["failed", "busy", "no-answer", "canceled"].includes(status))
      markDialEnded(db, callId, "declined")
  },

  async recording(db, callId, form) {
    const rawPayload = getString(form.get("payload"))
    const payload = rawPayload
      ? (JSON.parse(rawPayload) as Record<string, unknown>)
      : null
    const callPayload = getRecord(payload?.call)
    const recordingUrl =
      getString(form.get("recordingUrl")) ||
      getString(form.get("recording_url")) ||
      getString(payload?.recordingUrl) ||
      getString(payload?.recording_url) ||
      getString(callPayload.recordingUrl)
    if (!recordingUrl) return null
    markDialEnded(db, callId, "completed")
    return auditManagedRecording(db, callId, recordingUrl, authHeader())
  },
}
