/**
 * Post-call audit for live AI voice-agent conversations.
 *
 * After a call ends we re-assemble the ENTIRE conversation into a single real
 * WAV (stored per-turn customer recordings are spliced together with freshly
 * synthesised TTS for the agent's lines and any typed turns), then pass that
 * full recording through the same AI Quality Auditor pipeline as uploaded
 * calls. The audit is persisted with `leadId` set to the call id so it can be
 * surfaced next to the call in the UI.
 */

import type { DatabaseSync } from "node:sqlite"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import type { AuditRun, Utterance } from "@/lib/cimet-ai-types"
import { getJourney } from "@/lib/server/db"
import { runAudit } from "@/lib/server/auditor"
import { textToSpeech } from "@/lib/server/sarvam"
import { concatWavs, trimWav, wavDurationMs } from "@/lib/server/wav"

const AGENT_VOICE = "ishita"
const MAX_SYNC_AUDIO_MS = 29_000

/** Per-turn customer recordings, kept so the full conversation can be
 *  re-assembled and played through the AI Quality Auditor after the call. */
const CALL_AUDIO_DIR = path.join(process.cwd(), "data", "call-audio")

export function turnAudioPath(callId: string, utteranceId: string): string {
  return path.join(CALL_AUDIO_DIR, callId, `${utteranceId}.wav`)
}

export function saveTurnAudio(
  callId: string,
  utteranceId: string,
  audio: Buffer
) {
  const dir = path.join(CALL_AUDIO_DIR, callId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(turnAudioPath(callId, utteranceId), audio)
}

/** Calls currently being audited (fire-and-forget dedupe). */
const auditing = new Set<string>()

function callRecords(db: DatabaseSync, callId: string) {
  const calls = db
    .prepare("SELECT id, journey_id, status FROM calls WHERE id = ?")
    .all(callId) as Array<{
    id: string
    journey_id: string
    status: string
  }>
  return calls[0] ?? null
}

function recordUtterances(db: DatabaseSync, callId: string): Utterance[] {
  const rows = db
    .prepare(
      "SELECT id, speaker, text, start_ms, end_ms FROM utterances WHERE call_id = ? ORDER BY start_ms, id"
    )
    .all(callId) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: String(r.id),
    speaker: String(r.speaker) as Utterance["speaker"],
    text: String(r.text),
    startMs: Number(r.start_ms ?? 0),
    endMs: Number(r.end_ms ?? 0),
  }))
}

/** Facts the auditor cross-checks against the call, mapped from the journey. */
export function factsFromJourney(db: DatabaseSync, journeyId: string) {
  const journey = getJourney(db, journeyId)
  if (!journey) return null
  const fieldValue = (key: string) =>
    journey.fields.find((f) => f.key === key)?.value ?? undefined
  return {
    leadName: journey.customerName,
    agentName: "Maya Patel",
    retailer: journey.retailer,
    customerEmail: journey.email,
    postcode: fieldValue("postcode"),
    concession: fieldValue("concession"),
    lifeSupport: fieldValue("lifeSupport"),
    moveInDate: fieldValue("moveInDate"),
  }
}

async function buildConversationAudio(
  callId: string,
  utterances: Utterance[]
): Promise<Buffer | null> {
  const parts: Buffer[] = []
  for (const utterance of utterances) {
    const savedPath = turnAudioPath(callId, utterance.id)
    let pcm: Buffer | null = null
    if (existsSync(savedPath)) {
      pcm = readFileSync(savedPath)
    } else {
      try {
        const tts = await textToSpeech({
          text: utterance.text,
          speaker: utterance.speaker === "ai" ? AGENT_VOICE : "shubh",
          sampleRate: 16000,
          codec: "wav",
        })
        pcm = tts.audio
      } catch (error) {
        console.warn(
          "[call-audit] TTS failed for a turn, skipping it in the recording:",
          error instanceof Error ? error.message : error
        )
      }
    }
    if (pcm) parts.push(trimWav(pcm))
  }
  if (parts.length === 0) return null
  return concatWavs(parts, 250)
}

/**
 * Assemble the entire conversation audio and run it through the AI Quality
 * Auditor. Returns the persisted audit, or null when the conversation is too
 * sparse / too long for synchronous transcription.
 */
export async function runCallAudit(
  db: DatabaseSync,
  callId: string
): Promise<AuditRun | null> {
  const call = callRecords(db, callId)
  if (!call) throw new Error("Call not found")

  const facts = factsFromJourney(db, call.journey_id)
  if (!facts) {
    console.warn(
      `[call-audit] Journey ${call.journey_id} not found; skipping audit for ${callId}`
    )
    return null
  }

  const utterances = recordUtterances(db, callId)
  if (utterances.length < 2) {
    console.warn(
      `[call-audit] Call ${callId} has too few spoken turns (${utterances.length}); skipping`
    )
    return null
  }

  const audio = await buildConversationAudio(callId, utterances)
  if (!audio) {
    console.warn(
      `[call-audit] No audio could be assembled for ${callId}; skipping`
    )
    return null
  }

  const durationMs = wavDurationMs(audio)
  if (durationMs > MAX_SYNC_AUDIO_MS) {
    console.warn(
      `[call-audit] Call ${callId} conversation is ${Math.round(durationMs / 1000)}s, over the ${Math.round(MAX_SYNC_AUDIO_MS / 1000)}s synchronous-STT cap; skipping`
    )
    return null
  }

  const { audit } = await runAudit({
    audio,
    source: "voice-call",
    persistAudio: true,
    leadId: callId,
    attributes: facts,
  })
  return audit
}

/**
 * Fire-and-forget post-call audit with in-process dedupe so a call is audited
 * exactly once even if several terminal transitions race.
 */
export function queueCallAudit(db: DatabaseSync, callId: string) {
  if (auditing.has(callId)) return
  auditing.add(callId)
  void runCallAudit(db, callId)
    .then((audit) => {
      if (!audit) {
        console.log(`[call-audit] No audit produced for ${callId}`)
      }
    })
    .catch((error) => {
      console.error(
        `[call-audit] Audit failed for ${callId}:`,
        error instanceof Error ? error.message : error
      )
    })
    .finally(() => {
      auditing.delete(callId)
    })
}
