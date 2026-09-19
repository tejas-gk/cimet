import type { DatabaseSync } from "node:sqlite"

import {
  createHandoff,
  createUtterance,
  getJourney,
  listAudits,
  listCalls,
  updateCall,
  updateJourneyFieldValue,
} from "@/lib/server/db"

import { runAudit } from "@/lib/server/auditor"
import { factsFromJourney } from "@/lib/server/call-audit"

import { savePhoneTtsAudio } from "@/lib/server/phone/audio"

import {
  gather,
  play,
  response,
  say,
} from "@/lib/server/phone/twiml"

import {
  buildGreeting,
  processSolarTurn,
  synthesizeGreeting,
} from "@/lib/server/solar-agent"

import type {
  LeadContext,
  SolarConversationLine,
} from "@/lib/server/solar-agent"

import type {
  PhoneDialResult,
  PhoneProvider,
  PhoneTurnResult,
} from "@/lib/server/phone/types"

import type {
  Speaker,
  Utterance,
} from "@/lib/cimet-ai-types"

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

function requiredEnv(key: string) {
  const value =
    process.env[key]?.trim()

  if (!value) {
    throw new Error(
      `${key} is not configured`
    )
  }

  return value
}

function publicBaseUrl() {
  return requiredEnv(
    "APP_PUBLIC_BASE_URL"
  ).replace(/\/$/, "")
}

function absoluteUrl(path: string) {
  return `${publicBaseUrl()}${path}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Database helpers
// ─────────────────────────────────────────────────────────────────────────────

function callById(
  db: DatabaseSync,
  callId: string
) {
  return (
    listCalls(db).find(
      (call) => call.id === callId
    ) ?? null
  )
}

/**
 * Convert persisted journey fields into the format
 * expected by the recovery agent.
 *
 * This is CRITICAL.
 *
 * Every turn must use the latest journey state so the AI
 * never asks for something that has already been collected.
 */
function leadContextFromJourney(
  journey:
    | ReturnType<typeof getJourney>
    | null
): LeadContext {
  if (!journey) {
    return {}
  }

  const context: LeadContext = {}

  for (const field of journey.fields) {
    if (
      typeof field.value !== "string"
    ) {
      continue
    }

    const value =
      field.value.trim()

    if (!value) {
      continue
    }

    context[
      field.key as keyof LeadContext
    ] = value
  }

  return context
}

// ─────────────────────────────────────────────────────────────────────────────
// Utterance helpers
// ─────────────────────────────────────────────────────────────────────────────

function nextStartMs(
  utterances: Utterance[]
) {
  if (!utterances.length) {
    return 0
  }

  return (
    utterances[
      utterances.length - 1
    ].endMs + 500
  )
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

    endMs:
      startMs +
      Math.max(
        1800,
        text.length * 45
      ),
  })
}

function solarHistory(
  utterances: Utterance[]
): SolarConversationLine[] {
  const history:
    SolarConversationLine[] = []

  for (const utterance of utterances) {
    if (
      utterance.speaker ===
      "customer"
    ) {
      history.push({
        speaker: "user",
        text: utterance.text,
      })

      continue
    }

    if (
      utterance.speaker === "ai"
    ) {
      history.push({
        speaker: "ai",
        text: utterance.text,
      })

      continue
    }

    if (
      utterance.speaker ===
      "human-agent"
    ) {
      history.push({
        speaker: "human-agent",
        text: utterance.text,
      })
    }
  }

  /**
   * Enough recent context for natural conversation
   * without sending the entire call every time.
   */
  return history.slice(-30)
}

function isHumanAgentActive(
  utterances: Utterance[]
) {
  return utterances.some(
    (utterance) =>
      utterance.speaker ===
      "human-agent"
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Twilio URLs
// ─────────────────────────────────────────────────────────────────────────────

function speechAction(
  callId: string
) {
  return absoluteUrl(
    `/api/phone/twilio/${encodeURIComponent(
      callId
    )}/turn`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS / TwiML helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save Sarvam-generated WAV audio and return Twilio <Play>.
 *
 * If Sarvam TTS failed, fall back to Twilio <Say> so the
 * conversation does not completely die.
 */
function audioTag(
  callId: string,
  audioBase64:
    | string
    | null
    | undefined,
  fallbackText: string
) {
  const filename =
    savePhoneTtsAudio(
      callId,
      audioBase64
    )

  if (!filename) {
    console.warn(
      "[twilio] No Sarvam audio available. Falling back to Twilio Say."
    )

    return say(fallbackText)
  }

  const audioUrl =
    absoluteUrl(
      `/api/phone/tts/${encodeURIComponent(
        filename
      )}`
    )

  console.log(
    "[twilio] Playing TTS:",
    audioUrl
  )

  return play(audioUrl)
}

/**
 * Play one AI response and listen for customer speech.
 */
function continueConversation(
  callId: string,
  audioBase64:
    | string
    | null
    | undefined,
  fallbackText: string
) {
  return response(
    gather(
      speechAction(callId),

      audioTag(
        callId,
        audioBase64,
        fallbackText
      )
    )
  )
}

/**
 * Used when a result contains multiple turns,
 * e.g. AI announces handoff and then human speaks.
 */
function continueConversationTurns(
  callId: string,
  turns: Array<{
    audioBase64:
    | string
    | null

    text: string
  }>
) {
  const children =
    turns
      .map((turn) =>
        audioTag(
          callId,
          turn.audioBase64,
          turn.text
        )
      )
      .join("")

  return response(
    gather(
      speechAction(callId),
      children
    )
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Twilio authentication
// ─────────────────────────────────────────────────────────────────────────────

function twilioAuthHeader() {
  const accountSid =
    requiredEnv(
      "TWILIO_ACCOUNT_SID"
    )

  const authToken =
    requiredEnv(
      "TWILIO_AUTH_TOKEN"
    )

  const credentials =
    Buffer.from(
      `${accountSid}:${authToken}`
    ).toString("base64")

  return `Basic ${credentials}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Twilio REST API
// ─────────────────────────────────────────────────────────────────────────────

async function twilioPost<T>(
  path: string,
  body: URLSearchParams
): Promise<T> {
  const sid =
    requiredEnv(
      "TWILIO_ACCOUNT_SID"
    )

  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`

  console.log(
    "[twilio] POST",
    url
  )

  const res = await fetch(url, {
    method: "POST",

    headers: {
      Authorization:
        twilioAuthHeader(),

      "Content-Type":
        "application/x-www-form-urlencoded",
    },

    body,
  })

  const text =
    await res.text()

  if (!res.ok) {
    console.error(
      "[twilio] API ERROR",
      res.status,
      text
    )

    throw new Error(
      `Twilio request failed (${res.status}): ${text}`
    )
  }

  return JSON.parse(text) as T
}

// ─────────────────────────────────────────────────────────────────────────────
// Twilio recording
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTwilioRecording(
  recordingUrl: string
) {
  const url =
    recordingUrl.endsWith(".wav")
      ? recordingUrl
      : `${recordingUrl}.wav`

  const res = await fetch(url, {
    headers: {
      Authorization:
        twilioAuthHeader(),
    },
  })

  if (!res.ok) {
    throw new Error(
      `Failed to download Twilio recording (${res.status})`
    )
  }

  return Buffer.from(
    await res.arrayBuffer()
  )
}

async function auditRecording(
  db: DatabaseSync,
  callId: string,
  recordingUrl: string
) {
  const existing =
    listAudits(db).find(
      (audit) =>
        audit.leadId === callId
    ) ?? null

  if (existing) {
    return existing
  }

  const call =
    callById(db, callId)

  if (!call) {
    throw new Error(
      "Call not found"
    )
  }

  const facts =
    factsFromJourney(
      db,
      call.journeyId
    )

  if (!facts) {
    throw new Error(
      "Journey not found"
    )
  }

  const audio =
    await fetchTwilioRecording(
      recordingUrl
    )

  const { audit } =
    await runAudit({
      audio,

      source:
        "voice-call",

      persistAudio: true,

      leadId: callId,

      attributes: facts,
    })

  return audit
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export const twilioPhoneProvider:
  PhoneProvider = {
  id: "twilio",

  // ─────────────────────────────────────────────────────────────────────────
  // DIAL
  // ─────────────────────────────────────────────────────────────────────────

  async dial(
    db,
    callId
  ): Promise<PhoneDialResult> {
    const call =
      callById(
        db,
        callId
      )

    if (!call) {
      throw new Error(
        "Call not found"
      )
    }

    const journey =
      getJourney(
        db,
        call.journeyId
      )

    if (!journey) {
      throw new Error(
        "Journey not found"
      )
    }

    if (journey.doNotCall) {
      throw new Error(
        "Journey is marked do-not-call"
      )
    }

    if (
      !journey.phone?.trim()
    ) {
      throw new Error(
        "Journey does not have a phone number"
      )
    }

    const twimlUrl =
      absoluteUrl(
        `/api/phone/twilio/${encodeURIComponent(
          callId
        )}/twiml`
      )

    const statusUrl =
      absoluteUrl(
        `/api/phone/twilio/${encodeURIComponent(
          callId
        )}/status`
      )

    const recordingUrl =
      absoluteUrl(
        `/api/phone/twilio/${encodeURIComponent(
          callId
        )}/recording`
      )

    console.log(
      "[twilio] Dialing:",
      {
        callId,

        journeyId:
          call.journeyId,

        to:
          journey.phone,

        from:
          requiredEnv(
            "TWILIO_FROM_NUMBER"
          ),

        twimlUrl,

        statusUrl,

        recordingUrl,
      }
    )

    type TwilioCall = {
      sid: string
      status?: string
    }

    const result =
      await twilioPost<TwilioCall>(
        "/Calls.json",

        new URLSearchParams({
          To:
            journey.phone,

          From:
            requiredEnv(
              "TWILIO_FROM_NUMBER"
            ),

          Url:
            twimlUrl,

          Method:
            "POST",

          StatusCallback:
            statusUrl,

          StatusCallbackMethod:
            "POST",

          StatusCallbackEvent:
            "initiated ringing answered completed",

          Record:
            "true",

          RecordingStatusCallback:
            recordingUrl,

          RecordingStatusCallbackMethod:
            "POST",
        })
      )

    console.log(
      "[twilio] Call created:",
      {
        sid: result.sid,
        status: result.status,
      }
    )

    updateCall(
      db,
      callId,
      {
        status: "ringing",
      }
    )

    return {
      provider: this.id,

      providerCallId:
        result.sid,

      call:
        callById(
          db,
          callId
        )!,
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INITIAL ANSWER / GREETING
  // ─────────────────────────────────────────────────────────────────────────

  async initialTwiml(
    db,
    callId
  ): Promise<string> {
    console.log(
      "[twilio] initialTwiml:",
      callId
    )

    const call =
      callById(
        db,
        callId
      )

    if (!call) {
      throw new Error(
        "Call not found"
      )
    }

    /**
     * IMPORTANT:
     * Load existing journey data BEFORE creating the greeting.
     */
    const journey =
      getJourney(
        db,
        call.journeyId
      )

    if (!journey) {
      throw new Error(
        "Journey not found"
      )
    }

    const leadContext =
      leadContextFromJourney(
        journey
      )

    console.log(
      "[twilio] Initial lead context:",
      leadContext
    )

    /**
     * The exact text stored in history must match the
     * greeting we're synthesizing.
     */
    const greetingText =
      buildGreeting(
        leadContext
      )

    /**
     * Only store the greeting once.
     *
     * Twilio can retry webhooks, so don't duplicate it.
     */
    if (
      call.utterances.length === 0
    ) {
      db.exec(
        "BEGIN TRANSACTION"
      )

      try {
        savePhoneUtterance(
          db,
          callId,
          "ai",
          greetingText,
          0
        )

        updateCall(
          db,
          callId,
          {
            status:
              "collecting",

            startedAt:
              new Date().toISOString(),
          }
        )

        db.exec(
          "COMMIT"
        )
      } catch (error) {
        db.exec(
          "ROLLBACK"
        )

        throw error
      }
    }

    /**
     * Sarvam generates the actual Priya voice.
     *
     * IMPORTANT:
     * Pass leadContext so known information can be used
     * in the greeting.
     */
    const audioBase64 =
      await synthesizeGreeting(
        leadContext
      )

    console.log(
      "[twilio] Greeting synthesized:",
      {
        callId,

        hasAudio:
          Boolean(
            audioBase64
          ),

        greeting:
          greetingText,
      }
    )

    return continueConversation(
      callId,
      audioBase64,
      greetingText
    )
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER TURN
  // ─────────────────────────────────────────────────────────────────────────

  async turnTwiml(
    db,
    callId,
    speech
  ): Promise<PhoneTurnResult> {
    const text =
      speech.trim()

    console.log(
      "[twilio] Customer speech:",
      {
        callId,
        text,
      }
    )

    // ───────────────────────────────────────────────────────────────────────
    // Empty recognition
    // ───────────────────────────────────────────────────────────────────────

    if (!text) {
      const fallback =
        "Sorry, I didn't quite catch that. Could you say that again for me?"

      return {
        twiml:
          continueConversation(
            callId,
            null,
            fallback
          ),

        audit: null,
      }
    }

    // ───────────────────────────────────────────────────────────────────────
    // Load call
    // ───────────────────────────────────────────────────────────────────────

    const call =
      callById(
        db,
        callId
      )

    if (!call) {
      throw new Error(
        "Call not found"
      )
    }

    // ───────────────────────────────────────────────────────────────────────
    // CRITICAL: Reload journey on EVERY turn
    // ───────────────────────────────────────────────────────────────────────

    const journey =
      getJourney(
        db,
        call.journeyId
      )

    if (!journey) {
      throw new Error(
        "Journey not found"
      )
    }

    const leadContext =
      leadContextFromJourney(
        journey
      )

    console.log(
      "[twilio] Journey before AI turn:",
      {
        callId,

        journeyId:
          call.journeyId,

        leadContext,
      }
    )

    // ───────────────────────────────────────────────────────────────────────
    // Run recovery/sales agent
    // ───────────────────────────────────────────────────────────────────────

    const result =
      await processSolarTurn({
        text,

        history:
          solarHistory(
            call.utterances
          ),

        humanAgent:
          Boolean(
            call.handoff
          ) ||
          isHumanAgentActive(
            call.utterances
          ),

        leadContext,
      }, db)

    console.log(
      "[twilio] AI result:",
      {
        transcript:
          result.transcript,

        currentField:
          result.currentField,

        nextMissingField:
          result.nextMissingField,

        missingFields:
          result.missingFields,

        newlyExtractedData:
          result.newlyExtractedData,

        journeyComplete:
          result.journeyComplete,

        optedOut:
          result.optedOut,

        handoff:
          result.handoff,
      }
    )

    // ─────────────────────────────────────────────────────────────────────
    // Persist conversation + extracted fields
    // ─────────────────────────────────────────────────────────────────────

    db.exec(
      "BEGIN TRANSACTION"
    )

    try {
      let startMs =
        nextStartMs(
          call.utterances
        )

      /**
       * Store customer utterance.
       */
      savePhoneUtterance(
        db,
        callId,
        "customer",
        result.transcript,
        startMs
      )

      startMs +=
        Math.max(
          1800,
          result.transcript.length *
          45
        ) + 500

      // If a handoff was created by this turn (or the call is already in
      // handoff), DO NOT persist or play any AI utterances. Humans will
      // speak directly when they accept the handoff.
      const handoffCreated = Boolean(result.handoff && !call.handoff)
      const turnsToPersist = (handoffCreated || call.handoff)
        ? result.turns.filter((t) => String(t.speaker) !== "ai")
        : result.turns

      /**
       * Store AI/human responses (filtered for handoff cases).
       */
      for (const turn of turnsToPersist) {
        savePhoneUtterance(
          db,
          callId,
          turn.speaker,
          turn.text,
          startMs
        )

        startMs +=
          Math.max(
            1800,
            turn.text.length *
            45
          ) + 500
      }

      /**
       * IMPORTANT:
       *
       * Persist ONLY fields collected/corrected during
       * this turn.
       *
       * Do NOT rewrite the entire leadContext every turn.
       */
      if (
        result.newlyExtractedData
      ) {
        for (
          const [
            key,
            rawValue,
          ] of Object.entries(
            result.newlyExtractedData
          )
        ) {
          if (
            typeof rawValue !==
            "string"
          ) {
            continue
          }

          const value =
            rawValue.trim()

          if (!value) {
            continue
          }

          console.log(
            "[twilio] Persisting field:",
            {
              key,
              value,
            }
          )

          updateJourneyFieldValue(
            db,
            call.journeyId,
            key,
            value,
            "ai"
          )
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Handoff
      // ─────────────────────────────────────────────────────────────────────

      if (
        result.handoff &&
        !call.handoff
      ) {
        // Create a handoff but do NOT save an AI utterance or emit any
        // TTS. The human agent will take over the live conversation.
        createHandoff(
          db,
          {
            callId,

            reason:
              result.handoff.reason,

            summary:
              result.handoff.summary,

            collected:
              result.handoff
                .collected ??
              [],

            remaining:
              result.missingFields ??
              [],
          }
        )

        updateCall(
          db,
          callId,
          {
            status:
              "handoff",
          }
        )
      }

      // ─────────────────────────────────────────────────────────────────────
      // Opt-out
      // ─────────────────────────────────────────────────────────────────────

      else if (
        result.optedOut
      ) {
        updateCall(
          db,
          callId,
          {
            status:
              "declined",

            endedAt:
              new Date().toISOString(),
          }
        )
      }

      // ─────────────────────────────────────────────────────────────────────
      // Journey completed
      // ─────────────────────────────────────────────────────────────────────

      else if (
        result.journeyComplete
      ) {
        updateCall(
          db,
          callId,
          {
            status:
              "completed",
          }
        )
      }

      // ─────────────────────────────────────────────────────────────────────
      // Still collecting
      // ─────────────────────────────────────────────────────────────────────

      else if (
        call.status !==
        "handoff"
      ) {
        updateCall(
          db,
          callId,
          {
            status:
              "collecting",
          }
        )
      }

      db.exec(
        "COMMIT"
      )
    } catch (error) {
      db.exec(
        "ROLLBACK"
      )

      console.error(
        "[twilio] Failed to persist turn:",
        error
      )

      throw error
    }

    // ───────────────────────────────────────────────────────────────────────
    // Return TwiML
    // ───────────────────────────────────────────────────────────────────────

    return {
      twiml:
        continueConversationTurns(
          callId,
          result.turns
        ),

      audit: null,
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TWILIO STATUS CALLBACK
  // ─────────────────────────────────────────────────────────────────────────

  async status(
    db,
    callId,
    form
  ): Promise<void> {
    const status =
      String(
        form.get(
          "CallStatus"
        ) ?? ""
      )

    const providerCallId =
      String(
        form.get(
          "CallSid"
        ) ?? ""
      )

    console.log(
      "[twilio] Status callback:",
      {
        callId,
        providerCallId,
        status,
      }
    )

    if (
      status ===
      "in-progress"
    ) {
      const call =
        callById(
          db,
          callId
        )

      if (
        call &&
        !call.startedAt
      ) {
        updateCall(
          db,
          callId,
          {
            status:
              "collecting",

            startedAt:
              new Date().toISOString(),
          }
        )
      }

      return
    }

    if (
      [
        "busy",
        "failed",
        "no-answer",
        "canceled",
      ].includes(status)
    ) {
      updateCall(
        db,
        callId,
        {
          status:
            "declined",

          endedAt:
            new Date().toISOString(),
        }
      )

      return
    }

    if (
      status ===
      "completed"
    ) {
      const call =
        callById(
          db,
          callId
        )

      /**
       * Don't destroy a useful final state such as
       * handoff/completed/declined.
       *
       * Just ensure endedAt exists.
       */
      if (call) {
        updateCall(
          db,
          callId,
          {
            endedAt:
              new Date().toISOString(),
          }
        )
      }
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RECORDING CALLBACK
  // ─────────────────────────────────────────────────────────────────────────

  async recording(
    db,
    callId,
    form
  ) {
    const recordingUrl =
      String(
        form.get(
          "RecordingUrl"
        ) ?? ""
      )

    const recordingStatus =
      String(
        form.get(
          "RecordingStatus"
        ) ?? ""
      )

    console.log(
      "[twilio] Recording callback:",
      {
        callId,
        recordingStatus,
        hasRecordingUrl:
          Boolean(
            recordingUrl
          ),
      }
    )

    if (!recordingUrl) {
      return null
    }

    return auditRecording(
      db,
      callId,
      recordingUrl
    )
  },
}