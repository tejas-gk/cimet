import type { DatabaseSync } from "node:sqlite"

import {
    createHandoff,
    createUtterance,
    getJourney,
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

import type { LeadContext, SolarConversationLine } from "@/lib/server/solar-agent"

import type { PhoneDialResult, PhoneProvider, PhoneTurnResult } from "@/lib/server/phone/types"

import type { Speaker, Utterance } from "@/lib/cimet-ai-types"

// ─────────────────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────────────────

function requiredEnv(key: string) {
    const value = process.env[key]?.trim()
    if (!value) throw new Error(`${key} is not configured`)
    return value
}

function publicBaseUrl() {
    return requiredEnv("APP_PUBLIC_BASE_URL").replace(/\/$/, "")
}

function absoluteUrl(path: string) {
    return `${publicBaseUrl()}${path}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Database helpers
// ─────────────────────────────────────────────────────────────────────────────

function callById(db: DatabaseSync, callId: string) {
    return listCalls(db).find((call) => call.id === callId) ?? null
}

function leadContextFromJourney(journey: ReturnType<typeof getJourney> | null): LeadContext {
    if (!journey) return {}
    const context: LeadContext = {}
    for (const field of journey.fields) {
        if (typeof field.value !== "string") continue
        const value = field.value.trim()
        if (!value) continue
        context[field.key as keyof LeadContext] = value
    }
    return context
}

// ─────────────────────────────────────────────────────────────────────────────
// Utterance helpers
// ─────────────────────────────────────────────────────────────────────────────

function nextStartMs(utterances: Utterance[]) {
    if (!utterances.length) return 0
    return utterances[utterances.length - 1].endMs + 500
}

function savePhoneUtterance(db: DatabaseSync, callId: string, speaker: Speaker, text: string, startMs: number) {
    createUtterance(db, {
        id: crypto.randomUUID(),
        callId,
        speaker,
        text,
        startMs,
        endMs: startMs + Math.max(1800, text.length * 45),
    })
}

function solarHistory(utterances: Utterance[]): SolarConversationLine[] {
    const history: SolarConversationLine[] = []
    for (const u of utterances) {
        if (u.speaker === "customer") history.push({ speaker: "user", text: u.text })
        else if (u.speaker === "ai") history.push({ speaker: "ai", text: u.text })
        else if (u.speaker === "human-agent") history.push({ speaker: "human-agent", text: u.text })
    }
    return history.slice(-30)
}

// ─────────────────────────────────────────────────────────────────────────────
// Exotel URLs
// ─────────────────────────────────────────────────────────────────────────────

function speechAction(callId: string) {
    return absoluteUrl(`/api/phone/exotel/${encodeURIComponent(callId)}/turn`)
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS / TwiML helpers
// ─────────────────────────────────────────────────────────────────────────────

function audioTag(callId: string, audioBase64: string | null | undefined, fallbackText: string) {
    const filename = savePhoneTtsAudio(callId, audioBase64)
    if (!filename) return say(fallbackText)
    const audioUrl = absoluteUrl(`/api/phone/tts/${encodeURIComponent(filename)}`)
    return play(audioUrl)
}

function continueConversation(callId: string, audioBase64: string | null | undefined, fallbackText: string) {
    return response(gather(speechAction(callId), audioTag(callId, audioBase64, fallbackText)))
}

function continueConversationTurns(callId: string, turns: Array<{ audioBase64: string | null; text: string }>) {
    const children = turns.map((t) => audioTag(callId, t.audioBase64, t.text)).join("")
    return response(gather(speechAction(callId), children))
}

// ─────────────────────────────────────────────────────────────────────────────
// Exotel authentication
// ─────────────────────────────────────────────────────────────────────────────

function exotelAuthHeader() {
    const apiKey = requiredEnv("EXOTEL_API_KEY")
    const apiToken = requiredEnv("EXOTEL_API_TOKEN")
    const credentials = Buffer.from(`${apiKey}:${apiToken}`).toString("base64")
    return `Basic ${credentials}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Exotel REST API
// ─────────────────────────────────────────────────────────────────────────────

async function exotelPost<T>(path: string, body: URLSearchParams): Promise<T> {
    const accountSid = requiredEnv("EXOTEL_ACCOUNT_SID")
    const url = `https://api.exotel.com/v1/Accounts/${accountSid}${path}`

    console.log("[exotel] POST", url)

    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: exotelAuthHeader(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
    })

    const text = await res.text()
    if (!res.ok) {
        console.error("[exotel] API ERROR", res.status, text)
        throw new Error(`Exotel request failed (${res.status}): ${text}`)
    }

    return JSON.parse(text) as T
}

async function fetchExotelRecording(recordingUrl: string) {
    const url = recordingUrl.endsWith(".wav") ? recordingUrl : `${recordingUrl}.wav`
    const res = await fetch(url, {
        headers: { Authorization: exotelAuthHeader() },
    })
    if (!res.ok) throw new Error(`Failed to download Exotel recording (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
}

async function auditRecording(db: DatabaseSync, callId: string, recordingUrl: string) {
    const existing = listCalls(db).find((c) => c.id === callId) ?? null
    if (!existing) throw new Error("Call not found")
    const facts = factsFromJourney(db, existing.journeyId)
    if (!facts) throw new Error("Journey not found")
    const audio = await fetchExotelRecording(recordingUrl)
    const { audit } = await runAudit({ audio, source: "voice-call", persistAudio: true, leadId: callId, attributes: facts })
    return audit
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export const exotelPhoneProvider: PhoneProvider = {
    id: "exotel",

    async dial(db, callId) {
        const call = callById(db, callId)
        if (!call) throw new Error("Call not found")
        const journey = getJourney(db, call.journeyId)
        if (!journey) throw new Error("Journey not found")
        if (journey.doNotCall) throw new Error("Journey is marked do-not-call")
        if (!journey.phone?.trim()) throw new Error("Journey does not have a phone number")

        const answerUrl = absoluteUrl(`/api/phone/exotel/${encodeURIComponent(callId)}/twiml`)
        const statusUrl = absoluteUrl(`/api/phone/exotel/${encodeURIComponent(callId)}/status`)
        const recordingUrl = absoluteUrl(`/api/phone/exotel/${encodeURIComponent(callId)}/recording`)

        const params = new URLSearchParams({
            To: journey.phone,
            From: requiredEnv("EXOTEL_FROM_NUMBER"),
            Url: answerUrl,
            Method: "POST",
            StatusCallback: statusUrl,
            StatusCallbackMethod: "POST",
            StatusCallbackEvent: "initiated ringing answered completed",
            Record: "true",
            RecordingCallback: recordingUrl,
            RecordingCallbackMethod: "POST",
        })

        console.log("[exotel] Dialing:", { callId, journeyId: call.journeyId, to: journey.phone, from: requiredEnv("EXOTEL_FROM_NUMBER"), answerUrl, statusUrl, recordingUrl })

        const result = await exotelPost<{ request_id?: string; status?: string; call_id?: string }>("/Calls", params)

        const providerCallId = result.call_id ?? result.request_id ?? ""

        console.log("[exotel] Call created:", { providerCallId, status: result.status })

        updateCall(db, callId, { status: "ringing" })

        return {
            provider: this.id,
            providerCallId,
            call: callById(db, callId)!,
        }
    },

    async initialTwiml(db, callId) {
        const call = callById(db, callId)
        if (!call) throw new Error("Call not found")
        const journey = getJourney(db, call.journeyId)
        if (!journey) throw new Error("Journey not found")
        const leadContext = leadContextFromJourney(journey)
        const greetingText = buildGreeting(leadContext)

        if (call.utterances.length === 0) {
            db.exec("BEGIN TRANSACTION")
            try {
                savePhoneUtterance(db, callId, "ai", greetingText, 0)
                updateCall(db, callId, { status: "collecting", startedAt: new Date().toISOString() })
                db.exec("COMMIT")
            } catch (error) {
                db.exec("ROLLBACK")
                throw error
            }
        }

        const audioBase64 = await synthesizeGreeting(leadContext)
        return continueConversation(callId, audioBase64, greetingText)
    },

    async turnTwiml(db, callId, speech) {
        const text = speech.trim()
        if (!text) return { twiml: continueConversation(callId, null, "Sorry, can you repeat that?"), audit: null }

        const call = callById(db, callId)
        if (!call) throw new Error("Call not found")
        const journey = getJourney(db, call.journeyId)
        if (!journey) throw new Error("Journey not found")
        const leadContext = leadContextFromJourney(journey)
        const result = await processSolarTurn({ text, history: solarHistory(call.utterances), humanAgent: Boolean(call.handoff), leadContext })

        db.exec("BEGIN TRANSACTION")
        try {
            let startMs = nextStartMs(call.utterances)
            savePhoneUtterance(db, callId, "customer", result.transcript, startMs)
            startMs += Math.max(1800, result.transcript.length * 45) + 500
            for (const turn of result.turns) {
                savePhoneUtterance(db, callId, turn.speaker as Speaker, turn.text, startMs)
                startMs += Math.max(1800, turn.text.length * 45) + 500
            }
            if (result.newlyExtractedData) {
                for (const [k, raw] of Object.entries(result.newlyExtractedData)) {
                    if (typeof raw !== "string") continue
                    const v = raw.trim()
                    if (!v) continue
                    updateJourneyFieldValue(db, call.journeyId, k, v, "ai")
                }
            }
            if (result.handoff && !call.handoff) {
                createHandoff(db, { callId, reason: result.handoff.reason, summary: result.handoff.summary, collected: result.handoff.collected ?? [], remaining: result.missingFields ?? [], status: "assigned", severity: "normal" })
                updateCall(db, callId, { status: "handoff" })
            } else if (result.optedOut) {
                updateCall(db, callId, { status: "declined", endedAt: new Date().toISOString() })
            } else if (result.journeyComplete) {
                updateCall(db, callId, { status: "completed" })
            } else if (call.status !== "handoff") {
                updateCall(db, callId, { status: "collecting" })
            }
            db.exec("COMMIT")
        } catch (error) {
            db.exec("ROLLBACK")
            throw error
        }

        return { twiml: continueConversationTurns(callId, result.turns), audit: null }
    },

    async status(db, callId, form) {
        const status = String(form.get("CallStatus") ?? "")
        const recordingUrl = String(form.get("RecordingUrl") ?? "")

        console.log("[exotel] Status callback:", { callId, status, recordingUrl })

        if (status === "in-progress") {
            const call = callById(db, callId)
            if (call && !call.startedAt) {
                updateCall(db, callId, { status: "collecting", startedAt: new Date().toISOString() })
            }
            return
        }

        if (["busy", "failed", "no-answer", "canceled"].includes(status)) {
            updateCall(db, callId, { status: "declined", endedAt: new Date().toISOString() })
            return
        }

        if (status === "completed") {
            const call = callById(db, callId)
            if (call) updateCall(db, callId, { endedAt: new Date().toISOString() })
        }

        if (recordingUrl) {
            await auditRecording(db, callId, recordingUrl)
        }
    },

    async recording(db, callId, form) {
        const recordingUrl = String(form.get("RecordingUrl") ?? "")
        if (!recordingUrl) return null
        return auditRecording(db, callId, recordingUrl)
    },
}