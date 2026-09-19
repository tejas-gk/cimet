import type { DatabaseSync } from "node:sqlite"

import {
  createHandoff,
  createUtterance,
  listAudits,
  listCalls,
  updateCall,
} from "@/lib/server/db"
import { runAudit } from "@/lib/server/auditor"
import { factsFromJourney } from "@/lib/server/call-audit"
import { savePhoneTtsAudio } from "@/lib/server/phone/audio"
import { gather, play, response, say } from "@/lib/server/phone/twiml"
import {
  processSolarTurn,
  SOLAR_GREETING,
  synthesizeGreeting,
} from "@/lib/server/solar-agent"
import type { SolarConversationLine } from "@/lib/server/solar-agent"
import type {
  PhoneDialResult,
  PhoneProvider,
  PhoneTurnResult,
} from "@/lib/server/phone/types"
import type { Speaker, Utterance } from "@/lib/cimet-ai-types"

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

function nextStartMs(utterances: Utterance[]) {
  return utterances.length ? utterances[utterances.length - 1].endMs + 500 : 0
}

function savePhoneUtterance(
  db: DatabaseSync,
  callId: string,
  speaker: Speaker,
  text: string,
  startMs: number
) {
  createUtterance(db, {
    id: crypto.randomUUID(),
    callId,
    speaker,
    text,
    startMs,
    endMs: startMs + Math.max(1800, text.length * 45),
  })
}

function solarHistory(utterances: Utterance[]) {
  const history: SolarConversationLine[] = []
  for (const utterance of utterances) {
    if (utterance.speaker === "customer") {
      history.push({ speaker: "user", text: utterance.text })
    } else if (utterance.speaker === "ai") {
      history.push({ speaker: "ai", text: utterance.text })
    } else if (utterance.speaker === "human-agent") {
      history.push({ speaker: "human-agent", text: utterance.text })
    }
  }
  return history.slice(-20)
}

function isHumanAgentActive(utterances: Utterance[]) {
  return utterances.some((utterance) => utterance.speaker === "human-agent")
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

function continueConversationTurns(
  callId: string,
  turns: Array<{ audioBase64: string | null; text: string }>
) {
  const children = turns
    .map((turn) => audioTag(callId, turn.audioBase64, turn.text))
    .join("")
  return response(gather(speechAction(callId), children))
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
    const call = callById(db, callId)
    if (!call) throw new Error("Call not found")

    if (call.utterances.length === 0) {
      db.exec("BEGIN TRANSACTION")
      try {
        savePhoneUtterance(db, callId, "ai", SOLAR_GREETING, 0)
        updateCall(db, callId, {
          status: "collecting",
          startedAt: new Date().toISOString(),
        })
        db.exec("COMMIT")
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    }

    const audioBase64 = await synthesizeGreeting()
    return continueConversation(callId, audioBase64, SOLAR_GREETING)
  },

  async turnTwiml(db, callId, speech): Promise<PhoneTurnResult> {
    const text = speech.trim()
    if (!text) {
      return {
        twiml: continueConversation(
          callId,
          null,
          "Sorry, I didn't catch that. Could you say it again?"
        ),
        audit: null,
      }
    }

    const call = callById(db, callId)
    if (!call) throw new Error("Call not found")

    const result = await processSolarTurn({
      text,
      history: solarHistory(call.utterances),
      humanAgent: !!call.handoff || isHumanAgentActive(call.utterances),
    })

    db.exec("BEGIN TRANSACTION")
    try {
      let startMs = nextStartMs(call.utterances)
      savePhoneUtterance(db, callId, "customer", result.transcript, startMs)
      startMs += Math.max(1800, result.transcript.length * 45) + 500

      for (const turn of result.turns) {
        savePhoneUtterance(db, callId, turn.speaker, turn.text, startMs)
        startMs += Math.max(1800, turn.text.length * 45) + 500
      }

      if (result.handoff && !call.handoff) {
        createHandoff(db, {
          callId,
          reason: result.handoff.reason,
          summary: result.handoff.summary,
          collected: result.handoff.collected,
          remaining: [],
        })
        updateCall(db, callId, { status: "handoff" })
      } else if (call.status !== "handoff") {
        updateCall(db, callId, { status: "collecting" })
      }

      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    return {
      twiml: continueConversationTurns(callId, result.turns),
      audit: null,
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
