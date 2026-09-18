import type { DatabaseSync } from "node:sqlite"

import { listAudits, listCalls, updateCall } from "@/lib/server/db"
import { runAudit } from "@/lib/server/auditor"
import { factsFromJourney } from "@/lib/server/call-audit"
import {
  endCallSilently,
  processTurn,
  startCall,
  synthesizeReply,
} from "@/lib/server/voice-agent"
import { savePhoneTtsAudio } from "@/lib/server/phone/audio"
import { gather, hangup, play, response, say } from "@/lib/server/phone/twiml"
import type {
  PhoneDialResult,
  PhoneProvider,
  PhoneTurnResult,
} from "@/lib/server/phone/types"

function requiredEnv(key: string) {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is not configured`)
  return value
}

function publicBaseUrl() {
  return requiredEnv("APP_PUBLIC_BASE_URL").replace(/\/$/, "")
}

function callById(db: DatabaseSync, callId: string) {
  return listCalls(db).find((call) => call.id === callId) ?? null
}

function absoluteUrl(path: string) {
  return `${publicBaseUrl()}${path}`
}

function speechAction(callId: string) {
  return absoluteUrl(`/api/phone/twilio/${encodeURIComponent(callId)}/turn`)
}

function audioTag(
  callId: string,
  audioBase64: string | null | undefined,
  fallbackText: string
) {
  const filename = savePhoneTtsAudio(callId, audioBase64)
  if (!filename) return say(fallbackText)
  return play(absoluteUrl(`/api/phone/tts/${encodeURIComponent(filename)}`))
}

function continueConversation(
  callId: string,
  audioBase64: string | null | undefined,
  fallbackText: string
) {
  return response(
    gather(speechAction(callId), audioTag(callId, audioBase64, fallbackText))
  )
}

function finishConversation(
  callId: string,
  audioBase64: string | null | undefined,
  fallbackText: string
) {
  return response(`${audioTag(callId, audioBase64, fallbackText)}${hangup()}`)
}

function twilioAuthHeader() {
  return `Basic ${Buffer.from(`${requiredEnv("TWILIO_ACCOUNT_SID")}:${requiredEnv("TWILIO_AUTH_TOKEN")}`).toString("base64")}`
}

async function twilioPost<T>(path: string, body: URLSearchParams): Promise<T> {
  const sid = requiredEnv("TWILIO_ACCOUNT_SID")
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`Twilio request failed (${res.status}): ${text}`)
  return JSON.parse(text) as T
}

async function fetchTwilioRecording(recordingUrl: string) {
  const url = recordingUrl.endsWith(".wav")
    ? recordingUrl
    : `${recordingUrl}.wav`
  const res = await fetch(url, {
    headers: { Authorization: twilioAuthHeader() },
  })
  if (!res.ok)
    throw new Error(`Failed to download Twilio recording (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

async function auditRecording(
  db: DatabaseSync,
  callId: string,
  recordingUrl: string
) {
  const existing =
    listAudits(db).find((audit) => audit.leadId === callId) ?? null
  if (existing) return existing
  const call = callById(db, callId)
  if (!call) throw new Error("Call not found")
  const facts = factsFromJourney(db, call.journeyId)
  if (!facts) throw new Error("Journey not found")
  const audio = await fetchTwilioRecording(recordingUrl)
  const { audit } = await runAudit({
    audio,
    source: "voice-call",
    persistAudio: true,
    leadId: callId,
    attributes: facts,
  })
  return audit
}

export const twilioPhoneProvider: PhoneProvider = {
  id: "twilio",

  async dial(db, callId): Promise<PhoneDialResult> {
    const call = callById(db, callId)
    if (!call) throw new Error("Call not found")
    const journey = (await import("@/lib/server/db")).getJourney(
      db,
      call.journeyId
    )
    if (!journey) throw new Error("Journey not found")
    if (journey.doNotCall) throw new Error("Journey is marked do-not-call")

    type TwilioCall = { sid: string }
    const result = await twilioPost<TwilioCall>(
      "/Calls.json",
      new URLSearchParams({
        To: journey.phone,
        From: requiredEnv("TWILIO_FROM_NUMBER"),
        Url: absoluteUrl(
          `/api/phone/twilio/${encodeURIComponent(callId)}/twiml`
        ),
        Method: "POST",
        StatusCallback: absoluteUrl(
          `/api/phone/twilio/${encodeURIComponent(callId)}/status`
        ),
        StatusCallbackMethod: "POST",
        StatusCallbackEvent: "initiated ringing answered completed",
        Record: "true",
        RecordingStatusCallback: absoluteUrl(
          `/api/phone/twilio/${encodeURIComponent(callId)}/recording`
        ),
        RecordingStatusCallbackMethod: "POST",
      })
    )

    updateCall(db, callId, { status: "ringing" })
    return {
      provider: this.id,
      providerCallId: result.sid,
      call: callById(db, callId)!,
    }
  },

  async initialTwiml(db, callId): Promise<string> {
    const result = await startCall(db, callId)
    return continueConversation(
      callId,
      result.audioBase64,
      result.call.utterances.at(-1)?.text ?? "Hello from CIMET."
    )
  },

  async turnTwiml(db, callId, speech): Promise<PhoneTurnResult> {
    const text = speech.trim()
    if (!text) {
      const result = await endCallSilently(db, callId)
      const closing = result.call.utterances.at(-1)?.text ?? "Goodbye."
      const audio = await synthesizeReply(closing).catch(() => null)
      return {
        twiml: finishConversation(callId, audio, closing),
        audit: result.audit,
      }
    }

    const result = await processTurn({ db, callId, text })
    const reply = result.call.utterances.at(-1)?.text ?? "Thank you."
    const terminal = ["completed", "declined", "handoff"].includes(
      result.call.status
    )
    return {
      twiml: terminal
        ? finishConversation(callId, result.audioBase64, reply)
        : continueConversation(callId, result.audioBase64, reply),
      audit: result.audit ?? null,
    }
  },

  async status(db, callId, form): Promise<void> {
    const status = String(form.get("CallStatus") ?? "")
    if (["busy", "failed", "no-answer", "canceled"].includes(status)) {
      updateCall(db, callId, {
        status: "declined",
        endedAt: new Date().toISOString(),
      })
    }
  },

  async recording(db, callId, form) {
    const recordingUrl = String(form.get("RecordingUrl") ?? "")
    if (!recordingUrl) return null
    return auditRecording(db, callId, recordingUrl)
  },
}
