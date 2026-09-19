/**
 * Server-side AI Quality Auditor pipeline (Project 2).
 *
 * Three independent algorithms, then one deterministic rule engine:
 *
 *   SCRIPT     — verbatim requirements (approved wording) → deterministic
 *                token-similarity match; semantic requirements → LLM
 *                classification + evidence.
 *   FACT       — the LLM only EXTRACTS values spoken on the call; plain
 *                TypeScript compares them against the lead / plan data.
 *   BEHAVIOUR  — dead air + interruptions measured from timestamps,
 *                rapport/objection handling scored by the LLM. Coaching-only
 *                and never blocking.
 *
 * The rule engine (never the LLM) decides: any critical fail → HOLD;
 * critical uncertainty or non-critical issues → HUMAN REVIEW; clean critical
 * checks → auto-pass. Every check carries evidence that answers:
 * what failed, what proof, and when in the call.
 */

import fs from "node:fs"
import path from "node:path"

import { chatJson, speechToText, SARVAM_MODELS } from "@/lib/server/sarvam"
import { planForRetailer, checkDefsFor, type QaCheckDef } from "@/lib/server/qa"
import {
  normalizeValue,
  phraseSimilarity,
  valuesMatch,
  type NormalizeKind,
} from "@/lib/server/similarity"
import type {
  AuditCheck,
  AuditDecision,
  AuditRun,
  AuditVerdict,
  Utterance,
} from "@/lib/cimet-ai-types"

export class AuditError extends Error {
  constructor(
    message: string,
    public code = "audit_failed"
  ) {
    super(message)
    this.name = "AuditError"
  }
}

export const DEAD_AIR_WARNING_MS = 15_000
export const INTERRUPTION_WARNING_COUNT = 3

// Verbatim script-check thresholds (tunable): similarity ≥ PASS → pass,
// ≤ FAIL → fail, in between → the human reviewer decides.
export const SCRIPT_PASS_SIMILARITY = 0.85
export const SCRIPT_FAIL_SIMILARITY = 0.65

const DATA_DIR = path.join(process.cwd(), "data")
const RECORDINGS_DIR = path.join(DATA_DIR, "recordings")

export function recordingsDir() {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true })
  return RECORDINGS_DIR
}

export function saveRecording(id: string, audio: Buffer): string {
  const target = path.join(recordingsDir(), `${id}.wav`)
  fs.writeFileSync(target, audio)
  return `${id}.wav`
}

// ---------------------------------------------------------------------------
// Lead facts — the CRM / plan values the call is cross-checked against
// ---------------------------------------------------------------------------

export type AuditLeadFacts = {
  leadName: string
  agentName: string
  retailer: string
  planId?: string
  customerEmail?: string
  address?: string
  postcode?: string
  dob?: string
  fuelType?: string
  nmiMirn?: string
  concession?: string
  lifeSupport?: string
  moveInDate?: string
}

// ---------------------------------------------------------------------------
// Speaker attribution
// ---------------------------------------------------------------------------

type AttributedChunk = {
  index: number
  text: string
  speaker: "customer" | "sales-agent"
  confidence: number
}

async function attributeSpeakers(
  chunks: Array<{ text: string }>
): Promise<AttributedChunk[]> {
  const chunkList = chunks.map((c, i) => `${i}. ${c.text}`).join("\n")

  const attribution = await chatJson<{
    speakers: Array<{
      chunkIndex: number
      speaker: "customer" | "sales-agent"
      confidence: number
    }>
  }>({
    model: SARVAM_MODELS.voice,
    maxTokens: 700,
    messages: [
      {
        role: "system",
        content:
          'You are a call-analytics engine. You are given consecutive chunks of a transcribed sales call between one sales agent and one customer. Assign each chunk to the speaker who most likely said it. Use cues from wording (policy phrasing, rate/plan details, disclaimers, greetings vs. personal questions, confirmations). Respond with ONLY a JSON object: {"speakers": [{"chunkIndex": number, "speaker": "customer"|"sales-agent", "confidence": 0-100}]}',
      },
      {
        role: "user",
        content: `TRANSCRIPT CHUNKS\n${chunkList}`,
      },
    ],
  })

  const byIndex = new Map<number, AttributedChunk>()
  for (const s of attribution.speakers ?? []) {
    const text = chunks[s.chunkIndex]?.text
    if (typeof s.chunkIndex === "number" && text !== undefined) {
      byIndex.set(s.chunkIndex, {
        index: s.chunkIndex,
        text,
        speaker: s.speaker === "customer" ? "customer" : "sales-agent",
        confidence: Math.max(0, Math.min(100, Number(s.confidence) || 50)),
      })
    }
  }

  // Any chunk the model skipped gets attributed by content heuristics.
  return chunks.map((c, index) => {
    const attributed = byIndex.get(index)
    if (attributed) return attributed
    const heuristic = heuristicSpeaker(c.text)
    return {
      index,
      text: c.text,
      speaker: heuristic,
      confidence: 55,
    }
  })
}

function heuristicSpeaker(text: string): "customer" | "sales-agent" {
  const agentPhrases =
    /(recorded|quality|compliance|plan|tariff|kilowatt|cents|kWh|pricing|energy|contract|bill|concession|retailer|rate|market|terms|confirmation|thank you for)/i
  const customerPhrases =
    /(okay|yes|no|sorry|hmm|um|I think|can you|why|really|what?|so|but|fine|sure)/i
  if (agentPhrases.test(text) && !customerPhrases.test(text))
    return "sales-agent"
  return "customer"
}

function buildUtterances(
  chunks: AttributedChunk[],
  chunkStarts: number[],
  chunkEnds: number[],
  idPrefix: string
): Utterance[] {
  const utterances: Utterance[] = []
  let current: { speaker: string; text: string[]; startMs: number } | null =
    null

  chunks.forEach((chunk, index) => {
    const startMs = chunkStarts[index] ?? 0
    if (!current || current.speaker !== chunk.speaker) {
      if (current) pushUtterance(current)
      current = { speaker: chunk.speaker, text: [chunk.text], startMs }
    } else {
      current.text.push(chunk.text)
    }
    void startMs
  })
  if (current) pushUtterance(current)

  function pushUtterance(group: {
    speaker: string
    text: string[]
    startMs: number
  }) {
    let start = group.startMs
    let end = start
    chunks.forEach((c, i) => {
      if (c.speaker === group.speaker) {
        const s = chunkStarts[i] ?? start
        const e = chunkEnds[i] ?? s
        start = Math.min(start, s)
        end = Math.max(end, e)
      }
    })
    if (end <= start) end = start + group.text.join(" ").length * 50
    utterances.push({
      id: `${idPrefix}-utt-${utterances.length + 1}`,
      speaker: group.speaker === "customer" ? "customer" : "sales-agent",
      text: group.text.join(" "),
      startMs: start,
      endMs: end,
    })
  }

  return utterances
}

// ---------------------------------------------------------------------------
// SCRIPT checks
// ---------------------------------------------------------------------------

function transcriptLines(utterances: Utterance[]): string {
  return utterances
    .map(
      (u) =>
        `utt "${u.id}" [${Math.round(u.startMs / 1000)}s-${Math.round(u.endMs / 1000)}s] ${u.speaker === "sales-agent" ? "agent" : "customer"}: ${u.text}`
    )
    .join("\n")
}

/** Verbatim requirement → deterministic token-similarity match. */
function runScriptVerbatim(
  def: QaCheckDef,
  utterances: Utterance[]
): AuditCheck {
  const expected = def.verbatim ?? ""
  const agentUtterances = utterances.filter((u) => u.speaker !== "customer")
  let best: { sim: number; utt: Utterance | null } = { sim: 0, utt: null }
  for (const utt of agentUtterances) {
    const sim = phraseSimilarity(expected, utt.text)
    if (sim > best.sim) best = { sim, utt }
  }
  const concatSim = phraseSimilarity(
    expected,
    agentUtterances.map((u) => u.text).join(" ")
  )
  if (concatSim > best.sim) best = { sim: concatSim, utt: best.utt }

  const evidence =
    best.utt && best.sim > 0
      ? [
          {
            utteranceId: best.utt.id,
            startMs: best.utt.startMs,
            endMs: best.utt.endMs,
            quote: best.utt.text,
          },
        ]
      : []

  const verdict: AuditVerdict =
    best.sim >= SCRIPT_PASS_SIMILARITY
      ? "pass"
      : best.sim > SCRIPT_FAIL_SIMILARITY
        ? "review"
        : best.utt
          ? "fail"
          : "review"

  const finding =
    verdict === "pass"
      ? `Required wording was stated (similarity ${Math.round(best.sim * 100)}%).`
      : verdict === "fail"
        ? `Required wording was not stated faithfully (similarity ${Math.round(best.sim * 100)}% < ${Math.round(SCRIPT_FAIL_SIMILARITY * 100)}%).`
        : `Required wording was partially covered (similarity ${Math.round(best.sim * 100)}%) — route to a human reviewer.`

  return {
    id: def.key,
    label: def.label,
    type: "script",
    critical: def.critical,
    verdict,
    confidence: Math.max(0, Math.min(100, Math.round(best.sim * 100))),
    finding,
    evidence: evidence as AuditCheck["evidence"],
  }
}

/** Semantic requirement → LLM classification with evidence. */
async function runScriptSemantic(
  def: QaCheckDef,
  utterances: Utterance[]
): Promise<AuditCheck> {
  try {
    const result = await chatJson<{
      asked: "yes" | "no" | "partial"
      utteranceId?: string
      note?: string
    }>({
      model: SARVAM_MODELS.voice,
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content:
            'You enforce sales-call compliance requirements. Given a diarized transcript and one requirement, decide only whether the agent satisfied it. "partial" means the agent came close but it was vague or interrupted. Respond with ONLY JSON: {"asked":"yes"|"no"|"partial","utteranceId":"utt id when relevant","note":"one short sentence"}',
        },
        {
          role: "user",
          content: `REQUIREMENT\n${def.semanticPrompt ?? def.label}\n\nTRANSCRIPT\n${transcriptLines(utterances)}`,
        },
      ],
    })

    const utt = result.utteranceId
      ? (utterances.find((u) => u.id === result.utteranceId) ?? null)
      : null
    const evidence = utt
      ? [
          {
            utteranceId: utt.id,
            startMs: utt.startMs,
            endMs: utt.endMs,
            quote: utt.text,
          },
        ]
      : []

    const verdict: AuditVerdict =
      result.asked === "yes"
        ? "pass"
        : result.asked === "no"
          ? "fail"
          : "review"

    return {
      id: def.key,
      label: def.label,
      type: "script",
      critical: def.critical,
      verdict,
      confidence: result.asked === "yes" ? 90 : result.asked === "no" ? 85 : 55,
      finding:
        result.asked === "yes"
          ? "Requirement satisfied on the call."
          : result.asked === "no"
            ? `Requirement was not met.${result.note ? ` ${result.note}` : ""}`
            : `Partially met — route to a human reviewer.${result.note ? ` ${result.note}` : ""}`,
      evidence: evidence as AuditCheck["evidence"],
    }
  } catch (error) {
    return {
      id: def.key,
      label: def.label,
      type: "script",
      critical: def.critical,
      verdict: "review",
      confidence: 40,
      finding: `Could not classify this requirement: ${
        error instanceof Error ? error.message : "model error"
      }`,
      evidence: [],
    }
  }
}

// ---------------------------------------------------------------------------
// FACT checks — LLM extracts, deterministic TS compares
// ---------------------------------------------------------------------------

type ExtractedFact = {
  field: string
  value: string
  utteranceId?: string
  confidence?: number
}

const EXTRACTION_FIELDS: Record<string, string> = {
  peakRate: "peak electricity rate in cents per kWh (number only, e.g. 31.9)",
  email: "any email address, normalised to user@domain.tld",
  address: "the street address mentioned, e.g. '25 Smith Street'",
  postcode: "the 4-digit postcode",
  dob: "date of birth as YYYY-MM-DD",
  nmiMirn: "the NMI or MIRN identifier (digits only)",
  fuelType: "fuel type as 'electricity' or 'gas'",
  concession: "whether the customer holds a concession card — 'yes' or 'no'",
  lifeSupport:
    "whether any person at the address requires life-support equipment — 'yes' or 'no'",
  moveInDate: "the move-in date as YYYY-MM-DD",
}

async function extractSpokenFacts(
  utterances: Utterance[],
  defs: QaCheckDef[]
): Promise<ExtractedFact[]> {
  const fields = defs
    .filter(
      (d) =>
        d.category === "fact" && d.extractAs && EXTRACTION_FIELDS[d.extractAs]
    )
    .map((d) => d.extractAs as string)
  const unique = [...new Set(fields)]
  if (unique.length === 0) return []

  const fieldBlock = unique
    .map((f) => `- ${f}: ${EXTRACTION_FIELDS[f]}`)
    .join("\n")

  const result = await chatJson<{ extracted?: ExtractedFact[] }>({
    model: SARVAM_MODELS.voice,
    maxTokens: 900,
    messages: [
      {
        role: "system",
        content:
          'You are a compliance data-extraction engine. Your ONLY job is to find values the speaker actually said — never judge or infer. Values may be given in words ("twenty eight point six"). Include an entry ONLY when a value was actually spoken; omit everything else. Respond with ONLY JSON: {"extracted":[{"field":"...","value":"...","utteranceId":"utt id","confidence":0-100}]}',
      },
      {
        role: "user",
        content: `FIELDS TO EXTRACT\n${fieldBlock}\n\nTRANSCRIPT\n${transcriptLines(utterances)}`,
      },
    ],
  })

  return (result.extracted ?? []).filter(
    (e) => e && typeof e.field === "string" && typeof e.value === "string"
  )
}

function runFactCheck(
  def: QaCheckDef,
  extracted: ExtractedFact[],
  facts: AuditLeadFacts,
  plan: ReturnType<typeof planForRetailer>,
  utterances: Utterance[]
): AuditCheck {
  const normalize = (def.normalize ?? "text") as NormalizeKind
  const rawExpected = String(
    def.source?.kind === "plan"
      ? (plan[def.source.field as keyof typeof plan] ?? "")
      : (facts[def.source?.field as keyof AuditLeadFacts] ?? "")
  )
  const expected = normalizeValue(normalize, rawExpected)
  const hit = extracted.find((e) => e.field === def.extractAs)
  const rawSpoken = hit?.value ?? ""
  const spoken = normalizeValue(normalize, rawSpoken)
  const utt = hit?.utteranceId
    ? (utterances.find((u) => u.id === hit.utteranceId) ?? null)
    : null

  const evidence =
    utt && spoken
      ? [
          {
            utteranceId: utt.id,
            startMs: utt.startMs,
            endMs: utt.endMs,
            quote: utt.text,
            ...(expected ? { correctValue: expected } : {}),
          },
        ]
      : []

  // Not spoken on the call → the human reviewer must decide.
  if (!spoken) {
    return {
      id: def.key,
      label: def.label,
      type: "factual",
      critical: def.critical,
      verdict: "review",
      confidence: hit?.confidence ? Math.round(Number(hit.confidence)) : 45,
      finding: `${def.label}: the value was not stated on the call — a human reviewer must verify against the record.`,
      evidence: utt ? (evidence as AuditCheck["evidence"]) : [],
    }
  }

  const matches = expected !== null && valuesMatch(normalize, spoken, expected)
  if (matches) {
    return {
      id: def.key,
      label: def.label,
      type: "factual",
      critical: def.critical,
      verdict: "pass",
      confidence: Math.max(80, Math.round(Number(hit?.confidence) || 85)),
      finding: `Spoken "${rawSpoken}" matched the record.`,
      evidence: evidence as AuditCheck["evidence"],
    }
  }

  return {
    id: def.key,
    label: def.label,
    type: "factual",
    critical: def.critical,
    verdict: "fail",
    confidence: Math.max(80, Math.round(Number(hit?.confidence) || 85)),
    finding: `Spoken "${rawSpoken}" does not match the record value "${rawExpected}" — ${def.label.toLowerCase()}.`,
    evidence: (evidence as AuditCheck["evidence"]).map((e) => ({
      ...e,
      correctValue: expected ?? undefined,
    })),
  }
}

// ---------------------------------------------------------------------------
// BEHAVIOUR checks — timestamps first, LLM for subjective coaching
// ---------------------------------------------------------------------------

function findUtteranceAt(
  utterances: Utterance[],
  timeMs: number
): Utterance | null {
  return (
    utterances.find((u) => timeMs >= u.startMs && timeMs <= u.endMs) ??
    [...utterances]
      .sort((a, b) => a.startMs - b.startMs)
      .findLast((u) => u.startMs <= timeMs) ??
    null
  )
}

function runDeadAirCheck(
  def: QaCheckDef,
  chunks: Array<{ startMs: number; endMs: number }>,
  utterances: Utterance[]
): AuditCheck {
  const sorted = [...chunks].sort((a, b) => a.startMs - b.startMs)
  let maxGapMs = 0
  let gapAtStart = 0
  let gapAtEnd = 0
  let nextUtt: Utterance | null = null
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].startMs - sorted[i].endMs
    if (gap > maxGapMs) {
      maxGapMs = gap
      gapAtStart = sorted[i].endMs
      gapAtEnd = sorted[i + 1].startMs
      nextUtt = findUtteranceAt(utterances, sorted[i + 1].startMs)
    }
  }

  const triggered = maxGapMs > DEAD_AIR_WARNING_MS
  const seconds = Math.round(maxGapMs / 1000)
  const evidence =
    triggered && nextUtt
      ? [
          {
            utteranceId: nextUtt.id,
            startMs: gapAtStart,
            endMs: gapAtEnd,
            quote: nextUtt.text,
          },
        ]
      : []

  return {
    id: def.key,
    label: def.label,
    type: "behaviour",
    critical: false,
    verdict: triggered ? "review" : "pass",
    confidence: triggered ? 60 : 95,
    finding: triggered
      ? `Coaching: ${seconds}s of dead air (threshold ${Math.round(DEAD_AIR_WARNING_MS / 1000)}s) around the next turn — keep the customer engaged.`
      : `No excessive dead air (longest pause ${seconds}s, threshold ${Math.round(DEAD_AIR_WARNING_MS / 1000)}s).`,
    evidence: evidence as AuditCheck["evidence"],
  }
}

function runInterruptionCheck(
  def: QaCheckDef,
  utterances: Utterance[]
): AuditCheck {
  const sorted = [...utterances].sort((a, b) => a.startMs - b.startMs)
  const overlaps: Array<{ a: Utterance; b: Utterance; ms: number }> = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]
      const b = sorted[j]
      if (b.startMs >= a.endMs) break
      if (a.speaker === b.speaker) continue
      const ms = Math.min(a.endMs, b.endMs) - b.startMs
      if (ms > 0) overlaps.push({ a, b, ms })
    }
  }

  const totalOverlapMs = overlaps.reduce((sum, o) => sum + o.ms, 0)
  const triggered = overlaps.length >= INTERRUPTION_WARNING_COUNT
  const worst = overlaps.sort((x, y) => y.ms - x.ms)[0]
  const evidence =
    worst && triggered
      ? [
          {
            utteranceId: worst.b.id,
            startMs: Math.max(worst.a.startMs, worst.b.startMs),
            endMs: Math.min(worst.a.endMs, worst.b.endMs),
            quote: worst.b.text,
          },
        ]
      : []

  return {
    id: def.key,
    label: def.label,
    type: "behaviour",
    critical: false,
    verdict: triggered ? "review" : "pass",
    confidence: triggered ? 60 : 95,
    finding: triggered
      ? `Coaching: ${overlaps.length} speaker overlaps (${(totalOverlapMs / 1000).toFixed(1)}s total) — let the customer finish.`
      : `No significant interruptions (${overlaps.length} overlaps).`,
    evidence: evidence as AuditCheck["evidence"],
  }
}

async function runRapportCheck(
  def: QaCheckDef,
  utterances: Utterance[]
): Promise<AuditCheck> {
  try {
    const result = await chatJson<{
      issue: boolean
      note: string
      utteranceId?: string
    }>({
      model: SARVAM_MODELS.voice,
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content:
            'You are a sales-coaching assistant. Rate the agent\'s rapport and objection handling on the call. This is coaching only — never route the sale. Respond with ONLY JSON: {"issue":true|false,"note":"one short coaching line","utteranceId":"utt id if relevant"}',
        },
        {
          role: "user",
          content: transcriptLines(utterances),
        },
      ],
    })

    const utt = result.utteranceId
      ? (utterances.find((u) => u.id === result.utteranceId) ?? null)
      : null
    const evidence = utt
      ? [
          {
            utteranceId: utt.id,
            startMs: utt.startMs,
            endMs: utt.endMs,
            quote: utt.text,
          },
        ]
      : []

    return {
      id: def.key,
      label: def.label,
      type: "behaviour",
      critical: false,
      verdict: result.issue ? "review" : "pass",
      confidence: result.issue ? 60 : 90,
      finding: result.issue
        ? `Coaching: ${result.note}`
        : `Rapport and objection handling were adequate.`,
      evidence: evidence as AuditCheck["evidence"],
    }
  } catch (error) {
    return {
      id: def.key,
      label: def.label,
      type: "behaviour",
      critical: false,
      verdict: "pass",
      confidence: 70,
      finding: `Rapport coaching unavailable (${error instanceof Error ? "model error" : "unknown"}) — no blocking outcome.`,
      evidence: [],
    }
  }
}

// ---------------------------------------------------------------------------
// Rule engine — deterministic final decision
// ---------------------------------------------------------------------------

function routeAudit(checks: AuditCheck[]): {
  status: AuditDecision
  confidence: number
} {
  // Behaviour checks are coaching-only and non-blocking; they do not gate.
  const gating = checks.filter((c) => c.type !== "behaviour")
  const critical = gating.filter((c) => c.critical)
  const criticalFails = critical.filter((c) => c.verdict === "fail")
  const gatingFails = gating.filter((c) => c.verdict === "fail")
  const reviews = gating.filter((c) => c.verdict === "review")

  let confidence: number
  if (critical.length > 0) {
    confidence = Math.min(...critical.map((c) => c.confidence))
  } else if (gating.length > 0) {
    confidence = Math.round(
      gating.reduce((sum, c) => sum + c.confidence, 0) / gating.length
    )
  } else {
    confidence = 50
  }
  confidence = Math.max(0, Math.min(100, Math.round(confidence)))

  // Any critical check fails → hold the sale for the compliance team.
  if (criticalFails.length > 0) {
    return { status: "hold", confidence }
  }
  // A non-critical failure that is proven still blocks auto-submission.
  if (gatingFails.length > 0) {
    return { status: "human-review", confidence }
  }
  // Critical uncertainty, uncertainty on anything, or low confidence → human.
  if (reviews.length > 0 || confidence < 70) {
    return { status: "human-review", confidence }
  }
  return { status: "auto-pass", confidence }
}

function buildSummary(checks: AuditCheck[], status: AuditDecision): string {
  const fails = checks.filter((c) => c.verdict === "fail")
  const criticalFails = fails.filter((c) => c.critical)
  const reviews = checks.filter((c) => c.verdict === "review")
  const coaching = checks.filter(
    (c) => c.type === "behaviour" && c.verdict === "review"
  )
  return `${checks.length} checks run; ${criticalFails.length} critical failure${
    criticalFails.length === 1 ? "" : "s"
  }, ${reviews.length} uncertain, ${coaching.length} coaching note${
    coaching.length === 1 ? "" : "s"
  }. Decision: ${status}.`
}

// ---------------------------------------------------------------------------
// Public pipeline
// ---------------------------------------------------------------------------

export async function runAudit(input: {
  audio: Buffer
  source: "upload" | "generated-demo" | "voice-call"
  attributes: AuditLeadFacts
  persistAudio?: boolean
  leadId?: string
}): Promise<{ audit: AuditRun; transcript: string }> {
  const { leadName, agentName, retailer } = input.attributes
  const facts = input.attributes

  if (input.audio.length === 0) {
    throw new AuditError("No audio received", "no_audio")
  }

  // 1. Real transcription with timestamps.
  const stt = await speechToText({ audio: input.audio, filename: "call.wav" })
  const transcriptText = stt.transcript.trim()
  if (!transcriptText) {
    throw new AuditError(
      "Sarvam STT returned no speech — the file may be silent or in an unsupported format.",
      "empty_transcript"
    )
  }

  const auditId = `audit-${crypto.randomUUID().slice(0, 8)}`

  // 2. Group STT words into phrases and attribute them to speakers.
  const words = stt.chunks
  const segments: Array<{ text: string; startMs: number; endMs: number }> = []
  if (words.length) {
    let segment: {
      words: string[]
      startMs: number
      lastEndMs: number
    } | null = null
    const pushSegment = () => {
      if (!segment) return
      segments.push({
        text: segment.words.join(" "),
        startMs: segment.startMs,
        endMs: segment.lastEndMs,
      })
      segment = null
    }
    for (const word of words) {
      if (!segment) {
        segment = {
          words: [word.text],
          startMs: word.startMs,
          lastEndMs: word.endMs,
        }
      } else if (word.startMs - segment.lastEndMs >= 450) {
        pushSegment()
        segment = {
          words: [word.text],
          startMs: word.startMs,
          lastEndMs: word.endMs,
        }
      } else {
        segment.words.push(word.text)
        segment.lastEndMs = word.endMs
      }
    }
    pushSegment()
  } else {
    segments.push({
      text: stt.transcript,
      startMs: 0,
      endMs: stt.transcript.length * 60,
    })
  }

  const attributed = await attributeSpeakers(
    segments.map((s) => ({ text: s.text }))
  )
  const utterances = buildUtterances(
    attributed,
    segments.map((s) => s.startMs),
    segments.map((s) => s.endMs),
    auditId
  )

  // 3. Load the retailer-specific checklist + plan (source of truth).
  const plan = planForRetailer(retailer)
  const defs = checkDefsFor(retailer, facts)

  // 4. Facts: one LLM extraction pass, then deterministic comparisons.
  let extracted: ExtractedFact[] = []
  try {
    extracted = await extractSpokenFacts(utterances, defs)
  } catch (error) {
    // A failed extraction degrades fact checks to review, never fabricates.
    console.error("[cimet-ai] Fact extraction failed:", error)
  }

  const checks: AuditCheck[] = []
  for (const def of defs) {
    if (def.category === "script") {
      if (def.verbatim) {
        checks.push(runScriptVerbatim(def, utterances))
      } else {
        checks.push(await runScriptSemantic(def, utterances))
      }
    } else if (def.category === "fact") {
      checks.push(runFactCheck(def, extracted, facts, plan, utterances))
    } else if (def.category === "behaviour") {
      if (def.key === "dead-air") {
        checks.push(runDeadAirCheck(def, stt.chunks, utterances))
      } else if (def.key === "interruptions") {
        checks.push(runInterruptionCheck(def, utterances))
      } else {
        checks.push(await runRapportCheck(def, utterances))
      }
    }
  }

  // 5. Deterministic rule engine.
  const routing = routeAudit(checks)
  const summary = buildSummary(checks, routing.status)

  // 6. Persist (audio, transcript, checks, evidence).
  const recordingPath = input.persistAudio
    ? saveRecording(auditId, input.audio)
    : undefined

  const { createAuditFull } = await import("@/lib/server/db")
  const db = (await import("@/lib/server/db")).getDb()
  createAuditFull(db, auditId, {
    leadName,
    agentName,
    retailer,
    recordingPath,
    status: routing.status,
    confidence: routing.confidence,
    aiSummary: summary,
    transcript: utterances,
    checks,
    ...(input.leadId ? { leadId: input.leadId } : {}),
  })

  const audit = (await import("@/lib/server/db"))
    .listAudits(db)
    .find((a) => a.id === auditId)
  if (!audit) throw new AuditError("Audit failed to persist", "persist_failed")

  return { audit, transcript: transcriptText }
}
