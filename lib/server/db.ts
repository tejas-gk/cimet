/**
 * Server-only SQLite persistence layer for CIMET AI.
 *
 * Uses the built-in node:sqlite (Node ≥ 22).  All database access runs
 * server-side in Route Handlers so the Sarvam API key is never exposed.
 */

import { DatabaseSync, type SQLOutputValue } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"

import type {
  AuditCheck,
  AuditDecision,
  AuditEvidence,
  AuditRun,
  AuditVerdict,
  CallSession,
  CallStatus,
  EnergyJourney,
  EnergyJourneyField,
  EnergyJourneyStatus,
  HandoffContext,
  HandoffReason,
  HandoffSeverity,
  HandoffStatus,
  HumanAgent,
  HumanAgentStatus,
  Speaker,
  Utterance,
} from "@/lib/cimet-ai-types"
import {
  behaviourChecks as qaBehaviourChecks,
  factChecks as qaFactChecks,
  qaPlans,
  scriptChecks as qaScriptChecks,
} from "@/lib/server/qa"
import { ensureAgentsSeeded, ensureSeeded } from "@/lib/server/seed"

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DATA_DIR, "cimet.db")

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  _db = new DatabaseSync(DB_PATH)
  _db.exec("PRAGMA journal_mode = WAL")
  _db.exec("PRAGMA foreign_keys = ON")
  migrate(_db)
  return _db
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journeys (
      id            TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone         TEXT NOT NULL,
      email         TEXT NOT NULL,
      retailer      TEXT NOT NULL,
      state         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'dropped',
      abandon_step  TEXT NOT NULL DEFAULT '',
      do_not_call   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journey_fields (
      id           TEXT PRIMARY KEY,
      journey_id   TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
      field_key    TEXT NOT NULL,
      label        TEXT NOT NULL,
      value        TEXT,
      required     INTEGER NOT NULL DEFAULT 0,
      collected_by TEXT,
      position     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS calls (
      id                   TEXT PRIMARY KEY,
      journey_id           TEXT NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
      status               TEXT NOT NULL DEFAULT 'queued',
      consent_recorded     INTEGER NOT NULL DEFAULT 0,
      safety_score         REAL NOT NULL DEFAULT 100,
      provider             TEXT NOT NULL DEFAULT 'sarvam',
      current_question_key TEXT,
      repeat_count         INTEGER NOT NULL DEFAULT 0,
      started_at           TEXT,
      ended_at             TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS utterances (
      id        TEXT PRIMARY KEY,
      call_id   TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      speaker   TEXT NOT NULL,
      text      TEXT NOT NULL,
      start_ms  INTEGER NOT NULL,
      end_ms    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS human_agents (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      role           TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'online',
      max_concurrent INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      call_id          TEXT PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
      reason           TEXT NOT NULL,
      summary          TEXT NOT NULL,
      collected        TEXT NOT NULL DEFAULT '[]',
      remaining        TEXT NOT NULL DEFAULT '[]',
      status           TEXT NOT NULL DEFAULT 'waiting',
      severity         TEXT NOT NULL DEFAULT 'normal',
      assigned_agent_id TEXT REFERENCES human_agents(id) ON DELETE SET NULL,
      accepted_at      TEXT,
      callback_at      TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS handoff_events (
      id        TEXT PRIMARY KEY,
      call_id   TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      event     TEXT NOT NULL,
      detail    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audits (
      id               TEXT PRIMARY KEY,
      lead_name        TEXT NOT NULL,
      agent_name       TEXT NOT NULL,
      retailer         TEXT NOT NULL,
      recording_path   TEXT,
      status           TEXT NOT NULL,
      confidence       REAL NOT NULL,
      ai_summary       TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      override_auditor TEXT,
      override_decision TEXT,
      override_reason  TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_transcripts (
      id         TEXT PRIMARY KEY,
      audit_id   TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      speaker    TEXT NOT NULL,
      text       TEXT NOT NULL,
      start_ms   INTEGER NOT NULL,
      end_ms     INTEGER NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_checks (
      id        TEXT PRIMARY KEY,
      audit_id  TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      label     TEXT NOT NULL,
      check_type TEXT NOT NULL,
      critical  INTEGER NOT NULL DEFAULT 0,
      verdict   TEXT NOT NULL,
      confidence REAL NOT NULL,
      finding   TEXT NOT NULL,
      position  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_evidence (
      id             TEXT PRIMARY KEY,
      check_id       TEXT NOT NULL REFERENCES audit_checks(id) ON DELETE CASCADE,
      transcript_id  TEXT NOT NULL,
      start_ms       INTEGER NOT NULL,
      end_ms         INTEGER NOT NULL,
      quote          TEXT NOT NULL,
      correct_value  TEXT
    );

    CREATE TABLE IF NOT EXISTS lead_recordings (
      lead_id     TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      mime        TEXT NOT NULL,
      duration_ms INTEGER,
      transcript  TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plans (
      plan_id                          TEXT PRIMARY KEY,
      retailer                         TEXT NOT NULL,
      peak_rate_cents                  REAL NOT NULL,
      supply_charge_cents              REAL NOT NULL,
      gift_card_dollars                REAL NOT NULL,
      concession_disclosure_required   INTEGER NOT NULL DEFAULT 0,
      recording_disclaimer             TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS audit_check_defs (
      id            TEXT NOT NULL,
      retailer      TEXT NOT NULL,
      label         TEXT NOT NULL,
      check_type    TEXT NOT NULL,
      critical      INTEGER NOT NULL DEFAULT 0,
      coaching_only INTEGER NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      config        TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (id, retailer)
    );
  `)

  // Soft-migrate databases created before repeat_count existed.
  const callColumns = db.prepare("PRAGMA table_info(calls)").all() as Array<{
    name: string
  }>
  if (!callColumns.some((c) => c.name === "repeat_count")) {
    db.exec(
      "ALTER TABLE calls ADD COLUMN repeat_count INTEGER NOT NULL DEFAULT 0"
    )
  }

  const auditColumns = db.prepare("PRAGMA table_info(audits)").all() as Array<{
    name: string
  }>
  if (!auditColumns.some((c) => c.name === "lead_id")) {
    db.exec("ALTER TABLE audits ADD COLUMN lead_id TEXT")
  }

  // Soft-migrate databases created before handoff routing existed.
  const handoffColumns = db.prepare("PRAGMA table_info(handoffs)").all() as Array<{
    name: string
  }>
  if (!handoffColumns.some((c) => c.name === "status")) {
    db.exec(
      "ALTER TABLE handoffs ADD COLUMN status TEXT NOT NULL DEFAULT 'waiting'"
    )
    db.exec(
      "ALTER TABLE handoffs ADD COLUMN severity TEXT NOT NULL DEFAULT 'normal'"
    )
  }
  if (!handoffColumns.some((c) => c.name === "assigned_agent_id")) {
    db.exec("ALTER TABLE handoffs ADD COLUMN assigned_agent_id TEXT")
  }
  if (!handoffColumns.some((c) => c.name === "accepted_at")) {
    db.exec("ALTER TABLE handoffs ADD COLUMN accepted_at TEXT")
  }
  if (!handoffColumns.some((c) => c.name === "callback_at")) {
    db.exec("ALTER TABLE handoffs ADD COLUMN callback_at TEXT")
  }

  seedQaTables(db)
  ensureAgentsSeeded(db)
  ensureSeeded(db)
}

/**
 * Mirror the typed QA plan + check library (lib/server/qa.ts) into SQLite so
 * the checklist is a real queryable table and per-retailer checklists are
 * explicit.
 */
function seedQaTables(db: DatabaseSync) {
  const { qaPlans, scriptChecks, factChecks, behaviourChecks } = qaData()
  const upsertPlan = db.prepare(
    `INSERT INTO plans (plan_id, retailer, peak_rate_cents, supply_charge_cents, gift_card_dollars, concession_disclosure_required, recording_disclaimer)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plan_id) DO UPDATE SET
       retailer = excluded.retailer,
       peak_rate_cents = excluded.peak_rate_cents,
       supply_charge_cents = excluded.supply_charge_cents,
       gift_card_dollars = excluded.gift_card_dollars,
       concession_disclosure_required = excluded.concession_disclosure_required,
       recording_disclaimer = excluded.recording_disclaimer`
  )
  for (const plan of qaPlans) {
    upsertPlan.run(
      plan.planId,
      plan.retailer,
      plan.peakRateCents,
      plan.supplyChargeCents,
      plan.giftCardDollars,
      plan.concessionDisclosureRequired ? 1 : 0,
      plan.recordingDisclaimer
    )
  }

  const upsertCheck = db.prepare(
    `INSERT INTO audit_check_defs (id, retailer, label, check_type, critical, coaching_only, sort_order, config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, retailer) DO UPDATE SET
       label = excluded.label,
       check_type = excluded.check_type,
       critical = excluded.critical,
       coaching_only = excluded.coaching_only,
       config = excluded.config`
  )
  let order = 0
  for (const retailer of qaPlans.map((p) => p.retailer)) {
    for (const def of [...scriptChecks, ...factChecks, ...behaviourChecks]) {
      upsertCheck.run(
        def.key,
        retailer,
        def.label,
        def.category,
        def.critical ? 1 : 0,
        def.coachingOnly ? 1 : 0,
        order++,
        JSON.stringify({
          verbatim: def.verbatim,
          semanticPrompt: def.semanticPrompt,
          leadField: def.leadField,
          extractAs: def.extractAs,
          normalize: def.normalize,
          source: def.source,
        })
      )
    }
  }
}

function qaData() {
  return {
    qaPlans,
    scriptChecks: qaScriptChecks,
    factChecks: qaFactChecks,
    behaviourChecks: qaBehaviourChecks,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row<T extends Record<string, unknown>>(result: unknown): T {
  if (!result || typeof result !== "object")
    throw new Error("Expected a row object from SQLite")
  return result as T
}

function rows<T extends Record<string, unknown>>(result: unknown): T[] {
  return (result as T[]) ?? []
}

function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN TRANSACTION")
  try {
    const result = fn()
    db.exec("COMMIT")
    return result
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function requireStr(val: SQLOutputValue, label: string): string {
  if (val == null) throw new Error(`Column ${label} is unexpectedly null`)
  return String(val)
}

function num(val: SQLOutputValue): number {
  return Number(val ?? 0)
}

// ---------------------------------------------------------------------------
// Row → typed mappers
// ---------------------------------------------------------------------------

function mapField(r: Record<string, SQLOutputValue>): EnergyJourneyField {
  return {
    key: requireStr(r.field_key, "field_key"),
    label: requireStr(r.label, "label"),
    value: r.value == null ? null : String(r.value),
    required: Number(r.required) === 1,
    ...(r.collected_by
      ? { collectedBy: r.collected_by as "customer" | "ai" | "agent" }
      : {}),
  }
}

function mapJourney(
  r: Record<string, SQLOutputValue>,
  fields: EnergyJourneyField[] = []
): EnergyJourney {
  return {
    id: requireStr(r.id, "journey_id"),
    customerName: requireStr(r.customer_name, "customer_name"),
    phone: requireStr(r.phone, "phone"),
    email: requireStr(r.email, "email"),
    retailer: requireStr(r.retailer, "retailer"),
    state: requireStr(r.state, "state"),
    status: requireStr(r.status, "status") as EnergyJourneyStatus,
    abandonStep: String(r.abandon_step ?? ""),
    doNotCall: Number(r.do_not_call) === 1,
    fields,
  }
}

function mapUtterance(r: Record<string, SQLOutputValue>): Utterance {
  return {
    id: requireStr(r.id, "utterance_id"),
    speaker: requireStr(r.speaker, "speaker") as Speaker,
    text: requireStr(r.text, "text"),
    startMs: num(r.start_ms),
    endMs: num(r.end_ms),
  }
}

function mapHandoff(r: Record<string, SQLOutputValue>): HandoffContext {
  return {
    reason: requireStr(r.reason, "reason") as HandoffReason,
    summary: requireStr(r.summary, "summary"),
    collected: JSON.parse(String(r.collected ?? "[]")),
    remaining: JSON.parse(String(r.remaining ?? "[]")),
    status: (r.status ?? "waiting") as HandoffStatus,
    severity: (r.severity ?? "normal") as HandoffSeverity,
    ...(r.assigned_agent_id
      ? { assignedAgentId: String(r.assigned_agent_id) }
      : {}),
    ...(r.agent_name ? { assignedAgent: String(r.agent_name) } : {}),
    ...(r.accepted_at ? { acceptedAt: String(r.accepted_at) } : {}),
    ...(r.callback_at ? { callbackAt: String(r.callback_at) } : {}),
    ...(r.created_at ? { createdAt: String(r.created_at) } : {}),
  }
}

function mapEvidence(r: Record<string, SQLOutputValue>): AuditEvidence {
  return {
    utteranceId: requireStr(r.transcript_id, "transcript_id"),
    startMs: num(r.start_ms),
    endMs: num(r.end_ms),
    quote: requireStr(r.quote, "quote"),
    ...(r.correct_value ? { correctValue: String(r.correct_value) } : {}),
  }
}

function mapCheck(r: Record<string, SQLOutputValue>): AuditCheck {
  return {
    id: requireStr(r.id, "check_id"),
    label: requireStr(r.label, "label"),
    type: requireStr(r.check_type, "check_type") as AuditCheck["type"],
    critical: Number(r.critical) === 1,
    verdict: requireStr(r.verdict, "verdict") as AuditVerdict,
    confidence: num(r.confidence),
    finding: requireStr(r.finding, "finding"),
    evidence: [],
  }
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

export function listJourneys(db: DatabaseSync): EnergyJourney[] {
  const journeyRows = rows<Record<string, SQLOutputValue>>(
    db.prepare("SELECT * FROM journeys ORDER BY created_at, id").all()
  )
  const fields = rows<Record<string, SQLOutputValue>>(
    db
      .prepare("SELECT * FROM journey_fields ORDER BY journey_id, position")
      .all()
  )
  const fieldsByJourney = new Map<string, EnergyJourneyField[]>()
  for (const fr of fields) {
    const journeyId = String(fr.journey_id)
    const arr = fieldsByJourney.get(journeyId) ?? []
    arr.push(mapField(fr))
    fieldsByJourney.set(journeyId, arr)
  }
  return journeyRows.map((r) =>
    mapJourney(r, fieldsByJourney.get(requireStr(r.id, "id")) ?? [])
  )
}

export function getJourney(
  db: DatabaseSync,
  journeyId: string
): EnergyJourney | null {
  const r = row<Record<string, SQLOutputValue>>(
    db.prepare("SELECT * FROM journeys WHERE id = ?").get(journeyId)
  )
  if (!r) return null
  const fields = rows<Record<string, SQLOutputValue>>(
    db
      .prepare(
        "SELECT * FROM journey_fields WHERE journey_id = ? ORDER BY position"
      )
      .all(journeyId)
  ).map(mapField)
  return mapJourney(r, fields)
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export function listCalls(db: DatabaseSync): CallSession[] {
  const callRows = rows<Record<string, SQLOutputValue>>(
    db.prepare("SELECT * FROM calls ORDER BY created_at DESC, id").all()
  )
  const ids = callRows.map((r) => requireStr(r.id, "call_id"))
  const utterancesByCall = getUtterancesByCall(db, ids)
  const handoffByCall = getHandoffsByCall(db, ids)
  return callRows.map((r) => {
    const id = requireStr(r.id, "call_id")
    const base: CallSession = {
      id,
      journeyId: requireStr(r.journey_id, "journey_id"),
      status: requireStr(r.status, "status") as CallStatus,
      consentRecorded: Number(r.consent_recorded) === 1,
      safetyScore: num(r.safety_score),
      provider: requireStr(r.provider, "provider") as CallSession["provider"],
      ...(r.current_question_key
        ? { currentQuestionKey: String(r.current_question_key) }
        : {}),
      repeatCount: num(r.repeat_count),
      ...(r.started_at ? { startedAt: String(r.started_at) } : {}),
      ...(r.ended_at ? { endedAt: String(r.ended_at) } : {}),
      utterances: utterancesByCall.get(id) ?? [],
      ...(handoffByCall.get(id) ? { handoff: handoffByCall.get(id) } : {}),
    }
    return base
  })
}

function getUtterancesByCall(
  db: DatabaseSync,
  callIds: string[]
): Map<string, Utterance[]> {
  if (callIds.length === 0) return new Map()
  const ph = callIds.map(() => "?").join(",")
  const allUtterances = rows<Record<string, SQLOutputValue>>(
    db
      .prepare(
        `SELECT * FROM utterances WHERE call_id IN (${ph}) ORDER BY call_id, start_ms, id`
      )
      .all(...callIds)
  )
  const map = new Map<string, Utterance[]>()
  for (const u of allUtterances) {
    const callId = requireStr(u.call_id, "call_id")
    const arr = map.get(callId) ?? []
    arr.push(mapUtterance(u))
    map.set(callId, arr)
  }
  return map
}

function getHandoffsByCall(
  db: DatabaseSync,
  callIds: string[]
): Map<string, HandoffContext> {
  if (callIds.length === 0) return new Map()
  const ph = callIds.map(() => "?").join(",")
  const handoffRows = rows<Record<string, SQLOutputValue>>(
    db
      .prepare(
        `SELECT h.*, a.name AS agent_name
         FROM handoffs h
         LEFT JOIN human_agents a ON a.id = h.assigned_agent_id
         WHERE h.call_id IN (${ph})`
      )
      .all(...callIds)
  )
  const map = new Map<string, HandoffContext>()
  const waiting: Array<{ callId: string; severity: string; createdAt: string }> = []
  for (const r of handoffRows) {
    map.set(requireStr(r.call_id, "call_id"), mapHandoff(r))
    const status = String(r.status ?? "waiting")
    if (status === "waiting") {
      waiting.push({
        callId: requireStr(r.call_id, "call_id"),
        severity: String(r.severity ?? "normal"),
        createdAt: String(r.created_at ?? ""),
      })
    }
  }
  const severityWeight: Record<string, number> = { "life-support": 3, sensitive: 2, normal: 1 }
  waiting.sort((a, b) => {
    const w =
      (severityWeight[b.severity] ?? 0) - (severityWeight[a.severity] ?? 0)
    if (w !== 0) return w
    return a.createdAt.localeCompare(b.createdAt)
  })
  waiting.forEach((item, index) => {
    const entry = map.get(item.callId)
    if (!entry) return
    const position = index + 1
    entry.queuePosition = position
    entry.etaMinutes =
      item.severity === "life-support" ? 1 : Math.max(2, position * 3)
  })
  return map
}

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

export function listAudits(db: DatabaseSync): AuditRun[] {
  const auditRows = rows<Record<string, SQLOutputValue>>(
    db.prepare("SELECT * FROM audits ORDER BY created_at DESC, id").all()
  )
  const ids = auditRows.map((r) => requireStr(r.id, "id"))
  const transcriptMap = getAuditTranscriptsById(db, ids)
  const checksByAudit = getAuditChecksById(db, ids)
  return auditRows.map((r) => {
    const id = requireStr(r.id, "id")
    return {
      id,
      leadName: requireStr(r.lead_name, "lead_name"),
      agentName: requireStr(r.agent_name, "agent_name"),
      retailer: requireStr(r.retailer, "retailer"),
      ...(r.recording_path
        ? {
            recordingUrl: `/api/recordings/${encodeURIComponent(String(r.recording_path))}`,
          }
        : {}),
      ...(r.lead_id ? { leadId: String(r.lead_id) } : {}),
      status: requireStr(r.status, "status") as AuditDecision,
      confidence: num(r.confidence),
      aiSummary: requireStr(r.ai_summary, "ai_summary"),
      transcript: transcriptMap.get(id) ?? [],
      checks: checksByAudit.get(id) ?? [],
      ...(r.override_auditor && r.override_reason
        ? {
            override: {
              auditor: String(r.override_auditor),
              decision: String(r.override_decision) as AuditDecision,
              reason: String(r.override_reason),
            },
          }
        : {}),
    }
  })
}

function getAuditTranscriptsById(
  db: DatabaseSync,
  auditIds: string[]
): Map<string, Utterance[]> {
  if (auditIds.length === 0) return new Map()
  const ph = auditIds.map(() => "?").join(",")
  const all = rows<Record<string, SQLOutputValue>>(
    db
      .prepare(
        `SELECT * FROM audit_transcripts WHERE audit_id IN (${ph}) ORDER BY audit_id, position`
      )
      .all(...auditIds)
  )
  const map = new Map<string, Utterance[]>()
  for (const r of all) {
    const auditId = requireStr(r.audit_id, "audit_id")
    const arr = map.get(auditId) ?? []
    arr.push({
      id: requireStr(r.id, "id"),
      speaker: requireStr(r.speaker, "speaker") as Speaker,
      text: requireStr(r.text, "text"),
      startMs: num(r.start_ms),
      endMs: num(r.end_ms),
    })
    map.set(auditId, arr)
  }
  return map
}

function getAuditChecksById(
  db: DatabaseSync,
  auditIds: string[]
): Map<string, AuditCheck[]> {
  if (auditIds.length === 0) return new Map()
  const ph = auditIds.map(() => "?").join(",")
  const checkRows = rows<Record<string, SQLOutputValue>>(
    db
      .prepare(
        `SELECT * FROM audit_checks WHERE audit_id IN (${ph}) ORDER BY audit_id, position`
      )
      .all(...auditIds)
  )
  const checkIds = checkRows.map((r) => requireStr(r.id, "check_id"))
  const evidenceMap = getAuditEvidenceByCheckIds(db, checkIds)

  const map = new Map<string, AuditCheck[]>()
  for (const r of checkRows) {
    const auditId = requireStr(r.audit_id, "audit_id")
    const checkId = requireStr(r.id, "check_id")
    const check: AuditCheck = {
      ...mapCheck(r),
      evidence: evidenceMap.get(checkId) ?? [],
    }
    const arr = map.get(auditId) ?? []
    arr.push(check)
    map.set(auditId, arr)
  }
  return map
}

function getAuditEvidenceByCheckIds(
  db: DatabaseSync,
  checkIds: string[]
): Map<string, AuditEvidence[]> {
  if (checkIds.length === 0) return new Map()
  const ph = checkIds.map(() => "?").join(",")
  const all = rows<Record<string, SQLOutputValue>>(
    db
      .prepare(`SELECT * FROM audit_evidence WHERE check_id IN (${ph})`)
      .all(...checkIds)
  )
  const map = new Map<string, AuditEvidence[]>()
  for (const r of all) {
    const checkId = requireStr(r.check_id, "check_id")
    const arr = map.get(checkId) ?? []
    arr.push(mapEvidence(r))
    map.set(checkId, arr)
  }
  return map
}

// ---------------------------------------------------------------------------
// Mutations — Journeys
// ---------------------------------------------------------------------------

export function updateJourney(
  db: DatabaseSync,
  journeyId: string,
  patch: {
    status?: EnergyJourneyStatus
    doNotCall?: boolean
  }
) {
  const sets: string[] = ["updated_at = datetime('now')"]
  const params: (string | number)[] = []
  if (patch.status !== undefined) {
    sets.push("status = ?")
    params.push(patch.status)
  }
  if (patch.doNotCall !== undefined) {
    sets.push("do_not_call = ?")
    params.push(patch.doNotCall ? 1 : 0)
  }
  params.push(journeyId)
  db.prepare(`UPDATE journeys SET ${sets.join(", ")} WHERE id = ?`).run(
    ...params
  )
}

export function updateJourneyFieldValue(
  db: DatabaseSync,
  journeyId: string,
  fieldKey: string,
  value: string,
  collectedBy: "customer" | "ai" | "agent"
) {
  db.prepare(
    `UPDATE journey_fields
     SET value = ?, collected_by = ?, id = id
     WHERE journey_id = ? AND field_key = ?`
  ).run(value, collectedBy, journeyId, fieldKey)
}

// ---------------------------------------------------------------------------
// Mutations — Calls
// ---------------------------------------------------------------------------

export function createCall(
  db: DatabaseSync,
  call: {
    id: string
    journeyId: string
    status: CallStatus
    provider: string
  }
) {
  db.prepare(
    `INSERT INTO calls (id, journey_id, status, provider, safety_score, consent_recorded, created_at, updated_at)
     VALUES (?, ?, ?, ?, 100, 0, datetime('now'), datetime('now'))`
  ).run(call.id, call.journeyId, call.status, call.provider)
}

export function createJourneyWithCall(
  db: DatabaseSync,
  journey: {
    id: string
    customerName: string
    phone: string
    email: string
    retailer: string
    state: string
    abandonStep: string
    fields: Array<{
      key: string
      label: string
      value: string | null
      required: boolean
    }>
    callId: string
  }
) {
  db.prepare(
    `INSERT INTO journeys (id, customer_name, phone, email, retailer, state, status, abandon_step, do_not_call)
     VALUES (?, ?, ?, ?, ?, ?, 'dropped', ?, 0)`
  ).run(
    journey.id,
    journey.customerName,
    journey.phone,
    journey.email,
    journey.retailer,
    journey.state,
    journey.abandonStep
  )
  const insertField = db.prepare(
    `INSERT INTO journey_fields (id, journey_id, field_key, label, value, required, collected_by, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  journey.fields.forEach((field, position) => {
    insertField.run(
      `${journey.id}-field-${field.key}`,
      journey.id,
      field.key,
      field.label,
      field.value,
      field.required ? 1 : 0,
      field.value ? "customer" : null,
      position
    )
  })
  createCall(db, {
    id: journey.callId,
    journeyId: journey.id,
    status: "queued",
    provider: "sarvam",
  })
}

export function updateCall(
  db: DatabaseSync,
  callId: string,
  patch: {
    status?: CallStatus
    consentRecorded?: boolean
    safetyScore?: number
    currentQuestionKey?: string | null
    repeatCount?: number
    startedAt?: string | null
    endedAt?: string | null
  }
) {
  const sets: string[] = ["updated_at = datetime('now')"]
  const params: (string | number | null)[] = []
  if (patch.status !== undefined) {
    sets.push("status = ?")
    params.push(patch.status)
  }
  if (patch.consentRecorded !== undefined) {
    sets.push("consent_recorded = ?")
    params.push(patch.consentRecorded ? 1 : 0)
  }
  if (patch.safetyScore !== undefined) {
    sets.push("safety_score = ?")
    params.push(patch.safetyScore)
  }
  if (patch.currentQuestionKey !== undefined) {
    sets.push("current_question_key = ?")
    params.push(patch.currentQuestionKey ?? null)
  }
  if (patch.repeatCount !== undefined) {
    sets.push("repeat_count = ?")
    params.push(patch.repeatCount)
  }
  if (patch.startedAt !== undefined) {
    sets.push("started_at = ?")
    params.push(patch.startedAt ?? null)
  }
  if (patch.endedAt !== undefined) {
    sets.push("ended_at = ?")
    params.push(patch.endedAt ?? null)
  }
  params.push(callId)
  db.prepare(`UPDATE calls SET ${sets.join(", ")} WHERE id = ?`).run(...params)
}

export function createUtterance(
  db: DatabaseSync,
  u: {
    id: string
    callId: string
    speaker: Speaker
    text: string
    startMs: number
    endMs: number
  }
) {
  db.prepare(
    `INSERT INTO utterances (id, call_id, speaker, text, start_ms, end_ms)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(u.id, u.callId, u.speaker, u.text, u.startMs, u.endMs)
}

export function createHandoff(
  db: DatabaseSync,
  h: {
    callId: string
    reason: HandoffReason
    summary: string
    collected: Array<{ label: string; value: string }>
    remaining: string[]
    status?: HandoffStatus
    severity?: HandoffSeverity
    assignedAgentId?: string
    callbackAt?: string
  }
) {
  db.prepare(
    `INSERT INTO handoffs (call_id, reason, summary, collected, remaining, status, severity, assigned_agent_id, callback_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    h.callId,
    h.reason,
    h.summary,
    JSON.stringify(h.collected),
    JSON.stringify(h.remaining),
    h.status ?? "waiting",
    h.severity ?? "normal",
    h.assignedAgentId ?? null,
    h.callbackAt ?? null
  )
}

export function updateHandoff(
  db: DatabaseSync,
  callId: string,
  patch: {
    status?: HandoffStatus
    assignedAgentId?: string | null
    acceptedAt?: string | null
    callbackAt?: string | null
  }
) {
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (patch.status !== undefined) {
    sets.push("status = ?")
    params.push(patch.status)
  }
  if (patch.assignedAgentId !== undefined) {
    sets.push("assigned_agent_id = ?")
    params.push(patch.assignedAgentId)
  }
  if (patch.acceptedAt !== undefined) {
    sets.push("accepted_at = ?")
    params.push(patch.acceptedAt)
  }
  if (patch.callbackAt !== undefined) {
    sets.push("callback_at = ?")
    params.push(patch.callbackAt)
  }
  if (sets.length === 0) return
  params.push(callId)
  db.prepare(`UPDATE handoffs SET ${sets.join(", ")} WHERE call_id = ?`).run(
    ...params
  )
}

export function appendHandoffEvent(
  db: DatabaseSync,
  callId: string,
  event: string,
  detail = ""
) {
  db.prepare(
    `INSERT INTO handoff_events (id, call_id, event, detail)
     VALUES (?, ?, ?, ?)`
  ).run(crypto.randomUUID(), callId, event, detail)
}

// ---------------------------------------------------------------------------
// Human agents
// ---------------------------------------------------------------------------

export function listHumanAgents(db: DatabaseSync): HumanAgent[] {
  const agents = rows<Record<string, SQLOutputValue>>(
    db.prepare("SELECT * FROM human_agents ORDER BY created_at, name").all()
  )
  return agents.map((r) => {
    const id = requireStr(r.id, "agent_id")
    const activeHandoffs = num(
      row<Record<string, SQLOutputValue>>(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM handoffs
             WHERE assigned_agent_id = ? AND status IN ('assigned', 'accepted')`
          )
          .get(id)
      ).n
    )
    return {
      id,
      name: requireStr(r.name, "agent_name"),
      role: requireStr(r.role, "agent_role"),
      status: requireStr(r.status, "agent_status") as HumanAgentStatus,
      maxConcurrent: num(r.max_concurrent),
      activeHandoffs,
    }
  })
}

export function createHumanAgent(
  db: DatabaseSync,
  agent: { id: string; name: string; role: string; maxConcurrent?: number }
) {
  db.prepare(
    `INSERT INTO human_agents (id, name, role, max_concurrent)
     VALUES (?, ?, ?, ?)`
  ).run(
    agent.id,
    agent.name,
    agent.role,
    Math.max(1, agent.maxConcurrent ?? 1)
  )
}

export function setHumanAgentStatus(
  db: DatabaseSync,
  agentId: string,
  status: HumanAgentStatus
) {
  db.prepare("UPDATE human_agents SET status = ? WHERE id = ?").run(
    status,
    agentId
  )
}

// ---------------------------------------------------------------------------
// Mutations — Audits
// ---------------------------------------------------------------------------

export function createAudit(
  db: DatabaseSync,
  audit: {
    id: string
    leadName: string
    agentName: string
    retailer: string
    recordingPath?: string
    status: AuditDecision
    confidence: number
    aiSummary: string
    leadId?: string
  }
) {
  db.prepare(
    `INSERT INTO audits (id, lead_name, agent_name, retailer, recording_path, status, confidence, ai_summary, lead_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    audit.id,
    audit.leadName,
    audit.agentName,
    audit.retailer,
    audit.recordingPath ?? null,
    audit.status,
    audit.confidence,
    audit.aiSummary,
    audit.leadId ?? null
  )
}

export function createAuditTranscript(
  db: DatabaseSync,
  auditId: string,
  utterances: Utterance[]
) {
  const stmt = db.prepare(
    `INSERT INTO audit_transcripts (id, audit_id, speaker, text, start_ms, end_ms, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  utterances.forEach((u, position) => {
    stmt.run(u.id, auditId, u.speaker, u.text, u.startMs, u.endMs, position)
  })
}

export function createAuditCheck(
  db: DatabaseSync,
  auditId: string,
  check: AuditCheck,
  position: number
) {
  const checkRowId = `${auditId}:${check.id}`
  db.prepare(
    `INSERT INTO audit_checks (id, audit_id, label, check_type, critical, verdict, confidence, finding, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    checkRowId,
    auditId,
    check.label,
    check.type,
    check.critical ? 1 : 0,
    check.verdict,
    check.confidence,
    check.finding,
    position
  )
  for (const e of check.evidence) {
    db.prepare(
      `INSERT INTO audit_evidence (id, check_id, transcript_id, start_ms, end_ms, quote, correct_value)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `${checkRowId}-ev-${e.utteranceId}-${e.startMs}`,
      checkRowId,
      e.utteranceId,
      e.startMs,
      e.endMs,
      e.quote,
      e.correctValue ?? null
    )
  }
}

export function createAuditFull(
  db: DatabaseSync,
  auditId: string,
  audit: {
    leadName: string
    agentName: string
    retailer: string
    recordingPath?: string
    status: AuditDecision
    confidence: number
    aiSummary: string
    transcript: Utterance[]
    checks: AuditCheck[]
    leadId?: string
  }
) {
  db.exec("BEGIN TRANSACTION")
  try {
    createAudit(db, { id: auditId, ...audit })
    createAuditTranscript(db, auditId, audit.transcript)
    audit.checks.forEach((check, i) => createAuditCheck(db, auditId, check, i))
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function overrideAudit(
  db: DatabaseSync,
  auditId: string,
  decision: AuditDecision,
  reason: string
) {
  db.prepare(
    `UPDATE audits
     SET override_auditor = 'Team Lead', override_decision = ?, override_reason = ?, status = ?
     WHERE id = ?`
  ).run(decision, reason, decision, auditId)
}

// ---------------------------------------------------------------------------
// Lead recordings
// ---------------------------------------------------------------------------

export function saveLeadRecording(
  db: DatabaseSync,
  r: {
    leadId: string
    filename: string
    mime: string
    durationMs: number | null
    transcript: unknown[]
  }
) {
  db.prepare(
    `INSERT INTO lead_recordings (lead_id, filename, mime, duration_ms, transcript)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET
       filename = excluded.filename,
       mime = excluded.mime,
       duration_ms = excluded.duration_ms,
       transcript = excluded.transcript,
       created_at = datetime('now')`
  ).run(
    r.leadId,
    r.filename,
    r.mime,
    r.durationMs ?? null,
    JSON.stringify(r.transcript)
  )
}

export function getLeadRecording(
  db: DatabaseSync,
  leadId: string
): {
  filename: string
  mime: string
  durationMs: number | null
  transcript: unknown[]
} | null {
  const r = row<Record<string, SQLOutputValue>>(
    db.prepare("SELECT * FROM lead_recordings WHERE lead_id = ?").get(leadId)
  )
  if (!r) return null
  return {
    filename: requireStr(r.filename, "filename"),
    mime: requireStr(r.mime, "mime"),
    durationMs: r.duration_ms == null ? null : num(r.duration_ms),
    transcript: JSON.parse(String(r.transcript ?? "[]")) as unknown[],
  }
}

// ---------------------------------------------------------------------------
// QA config — plans + check library (seeded from lib/server/qa.ts)
// ---------------------------------------------------------------------------

export type QaPlanRow = {
  planId: string
  retailer: string
  peakRateCents: number
  supplyChargeCents: number
  giftCardDollars: number
  concessionDisclosureRequired: boolean
  recordingDisclaimer: string
}

export function listPlans(db: DatabaseSync): QaPlanRow[] {
  return rows<Record<string, SQLOutputValue>>(
    db.prepare("SELECT * FROM plans ORDER BY retailer").all()
  ).map((r) => ({
    planId: requireStr(r.plan_id, "plan_id"),
    retailer: requireStr(r.retailer, "retailer"),
    peakRateCents: num(r.peak_rate_cents),
    supplyChargeCents: num(r.supply_charge_cents),
    giftCardDollars: num(r.gift_card_dollars),
    concessionDisclosureRequired:
      Number(r.concession_disclosure_required) === 1,
    recordingDisclaimer: String(r.recording_disclaimer ?? ""),
  }))
}

export function listCheckDefs(
  db: DatabaseSync,
  retailer?: string
): Array<{
  id: string
  retailer: string
  label: string
  checkType: string
  critical: boolean
  coachingOnly: boolean
  config: Record<string, unknown>
}> {
  const all = rows<Record<string, SQLOutputValue>>(
    retailer
      ? db
          .prepare(
            "SELECT * FROM audit_check_defs WHERE retailer = ? ORDER BY sort_order"
          )
          .all(retailer)
      : db
          .prepare(
            "SELECT * FROM audit_check_defs ORDER BY retailer, sort_order"
          )
          .all()
  )
  return all.map((r) => ({
    id: requireStr(r.id, "id"),
    retailer: requireStr(r.retailer, "retailer"),
    label: requireStr(r.label, "label"),
    checkType: requireStr(r.check_type, "check_type"),
    critical: Number(r.critical) === 1,
    coachingOnly: Number(r.coaching_only) === 1,
    config: JSON.parse(String(r.config ?? "{}")) as Record<string, unknown>,
  }))
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function dashboardMetrics(db: DatabaseSync) {
  const counts = row<Record<string, SQLOutputValue>>(
    db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'auto-pass' THEN 1 ELSE 0 END) as auto_pass,
           SUM(CASE WHEN status = 'hold' THEN 1 ELSE 0 END) as hold,
           SUM(CASE WHEN status = 'human-review' THEN 1 ELSE 0 END) as review,
           SUM(CASE WHEN override_auditor IS NOT NULL THEN 1 ELSE 0 END) as has_override
         FROM audits`
      )
      .get()
  )
  const criticalFailures = num(
    row<Record<string, SQLOutputValue>>(
      db
        .prepare(
          `SELECT COUNT(*) as n FROM audit_checks WHERE critical = 1 AND verdict = 'fail'`
        )
        .get()
    ).n
  )
  const total = num(counts.total)
  const hasOverride = num(counts.has_override)
  const agreement =
    total > 0 ? Math.round(((total - hasOverride) / total) * 100) : 100
  return {
    total,
    autoPass: num(counts.auto_pass),
    hold: num(counts.hold),
    review: num(counts.review),
    criticalFailures,
    agreement,
  }
}
