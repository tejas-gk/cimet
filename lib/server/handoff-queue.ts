/**
 * Human-handoff routing queue.
 *
 * When the AI hands a call to a person, a free agent is picked from the
 * human-agents registry; if nobody is available the handoff is parked:
 *  - normal severity   → a call-back is scheduled (customer leaves the line)
 *  - sensitive / life-support → the customer stays on hold in the queue and a
 *    waiting slot is created, served in severity-then-arrival order as soon as
 *    any agent frees up.
 */

import type { DatabaseSync } from "node:sqlite"

import type {
  EnergyJourney,
  HandoffQueueItem,
  HandoffReason,
  HandoffSeverity,
  HandoffStatus,
  HumanAgent,
} from "@/lib/cimet-ai-types"
import {
  appendHandoffEvent,
  createHandoff,
  getJourney,
  listAudits,
  listHumanAgents,
  listCalls,
  setHumanAgentStatus,
  updateCall,
  updateHandoff,
  updateJourney,
} from "@/lib/server/db"
import { runCallAudit } from "@/lib/server/call-audit"

const CALLBACK_SLA_MINUTES = 15

const severityWeight: Record<HandoffSeverity, number> = {
  "life-support": 3,
  sensitive: 2,
  normal: 1,
}

function nowIso() {
  return new Date().toISOString()
}

function callbackAt(offsetMinutes = CALLBACK_SLA_MINUTES) {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString()
}

function minutesUntil(iso: string | undefined): number {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000))
}

/** Work out how urgent a handoff is for routing decisions. */
export function handoffSeverity(
  journey: EnergyJourney,
  reason: HandoffReason,
  safetyScore: number
): HandoffSeverity {
  const lifeSupport = journey.fields.find(
    (field) =>
      field.key.toLowerCase().includes("life") ||
      field.label.toLowerCase().includes("life support")
  )
  if (lifeSupport?.value && /yes/i.test(String(lifeSupport.value))) {
    return "life-support"
  }
  if (
    reason === "sensitive-topic" ||
    reason === "angry-customer" ||
    safetyScore <= 30
  ) {
    return "sensitive"
  }
  return "normal"
}

export type HandoffRouteResult = {
  mode: "assigned" | "waiting" | "callback"
  severity: HandoffSeverity
  agentId?: string
  agentName?: string
  queuePosition?: number
  etaMinutes?: number
  /** The exact line the voice agent should say out loud. */
  message: string
}

type OpenHandoffRow = {
  call_id: string
  reason: string
  summary: string
  collected: string
  remaining: string
  status: string
  severity: string
  assigned_agent_id: string | null
  accepted_at: string | null
  callback_at: string | null
  created_at: string | null
}

function openHandoffs(db: DatabaseSync): OpenHandoffRow[] {
  const rows = db
    .prepare(
      `SELECT call_id, reason, summary, collected, remaining, status, severity,
              assigned_agent_id, accepted_at, callback_at, created_at
       FROM handoffs
       WHERE status IN ('assigned', 'accepted', 'waiting', 'callback')`
    )
    .all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    call_id: String(r.call_id),
    reason: String(r.reason),
    summary: String(r.summary),
    collected: String(r.collected ?? "[]"),
    remaining: String(r.remaining ?? "[]"),
    status: String(r.status),
    severity: String(r.severity),
    assigned_agent_id: r.assigned_agent_id
      ? String(r.assigned_agent_id)
      : null,
    accepted_at: r.accepted_at ? String(r.accepted_at) : null,
    callback_at: r.callback_at ? String(r.callback_at) : null,
    created_at: r.created_at ? String(r.created_at) : null,
  }))
}

/** Order unresolved handoffs by severity, then arrival — highest urgency first. */
function sortByUrgency(rows: OpenHandoffRow[]) {
  return [...rows].sort((a, b) => {
    const w = severityWeight[b.severity as HandoffSeverity] -
      severityWeight[a.severity as HandoffSeverity]
    if (w !== 0) return w
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  })
}

function eligibleAgents(db: DatabaseSync): HumanAgent[] {
  return listHumanAgents(db)
    .filter((agent) => {
      if (agent.status === "away") return false
      const capacity = agent.maxConcurrent - agent.activeHandoffs
      if (capacity <= 0) return false
      return true
    })
    .sort((a, b) => {
      const loadA = a.activeHandoffs / Math.max(1, a.maxConcurrent)
      const loadB = b.activeHandoffs / Math.max(1, b.maxConcurrent)
      if (loadA !== loadB) return loadA - loadB
      return a.name.localeCompare(b.name)
    })
}

function agentById(db: DatabaseSync, agentId: string): HumanAgent | null {
  return listHumanAgents(db).find((agent) => agent.id === agentId) ?? null
}

function waitingPositions(
  rows: OpenHandoffRow[]
): Map<string, { position: number; etaMinutes: number }> {
  const map = new Map<
    string,
    { position: number; etaMinutes: number }
  >()
  const waiting = sortByUrgency(
    rows.filter((r) => r.status === "waiting")
  )
  waiting.forEach((row, index) => {
    const position = index + 1
    const severity = row.severity as HandoffSeverity
    map.set(row.call_id, {
      position,
      etaMinutes:
        severity === "life-support" ? 1 : Math.max(2, position * 3),
    })
  })
  return map
}

/**
 * Route a fresh handoff: assign the least-loaded available agent, or park the
 * call as waiting (sensitive/life-support) or as a scheduled callback (normal).
 */
export function routeHandoff(db: DatabaseSync, params: {
  callId: string
  journey: EnergyJourney
  reason: HandoffReason
  summary: string
  safetyScore: number
}): HandoffRouteResult {
  const { callId, journey, reason, summary, safetyScore } = params
  const severity = handoffSeverity(journey, reason, safetyScore)
  const agents = eligibleAgents(db)
  const agent = agents[0] ?? null

  const remaining = journey.fields
    .filter((field) => field.required && !field.value)
    .map((field) => field.label)
  const collected = journey.fields
    .filter((field) => field.value)
    .map((field) => ({ label: field.label, value: field.value as string }))

  if (agent) {
    createHandoff(db, {
      callId,
      reason,
      summary,
      collected,
      remaining,
      status: "assigned",
      severity,
      assignedAgentId: agent.id,
    })
    updateCall(db, callId, { status: "handoff", safetyScore })
    appendHandoffEvent(
      db,
      callId,
      "routed",
      `Assigned to ${agent.name} (${severity})`
    )
    return {
      mode: "assigned",
      severity,
      agentId: agent.id,
      agentName: agent.name,
      message: `I'm connecting you to ${agent.name} now — one moment, please.`,
    }
  }

  if (severity === "normal") {
    createHandoff(db, {
      callId,
      reason,
      summary,
      collected,
      remaining,
      status: "callback",
      severity,
      callbackAt: callbackAt(),
    })
    updateCall(db, callId, {
      status: "callback",
      safetyScore,
      endedAt: nowIso(),
    })
    appendHandoffEvent(
      db,
      callId,
      "callback",
      `No agent free — callback scheduled within ${CALLBACK_SLA_MINUTES}m (${severity})`
    )
    return {
      mode: "callback",
      severity,
      etaMinutes: CALLBACK_SLA_MINUTES,
      message: `I can't connect you to a specialist right now, so I'll have a colleague call you back within about ${CALLBACK_SLA_MINUTES} minutes. Thank you for your patience, and goodbye.`,
    }
  }

  // Sensitive / life-support, no free agent → hold in the queue.
  createHandoff(db, {
    callId,
    reason,
    summary,
    collected,
    remaining,
    status: "waiting",
    severity,
  })
  updateCall(db, callId, { status: "handoff", safetyScore })
  const rows = openHandoffs(db)
  const position = waitingPositions(rows).get(callId)?.position ?? 1
  appendHandoffEvent(
    db,
    callId,
    "queued",
    `No agent free — held on the line at position ${position} (${severity})`
  )
  return {
    mode: "waiting",
    severity,
    queuePosition: position,
    etaMinutes:
      severity === "life-support" ? 1 : Math.max(2, position * 3),
    message:
      severity === "life-support"
        ? "I'm making sure one of our specialists is available for you right now. Please stay on the line."
        : `All of my colleagues are helping other customers right now. You are number ${position} in the queue, and someone will be with you shortly. Please stay on the line.`,
  }
}

export function handoffForCall(db: DatabaseSync, callId: string) {
  const rows = openHandoffs(db)
  const row = rows.find((r) => r.call_id === callId)
  if (!row) return null
  const positions = waitingPositions(rows)
  const position = positions.get(callId)
  const agent = row.assigned_agent_id
    ? agentById(db, row.assigned_agent_id)
    : null
  return {
    status: row.status as HandoffStatus,
    severity: row.severity as HandoffSeverity,
    agentId: row.assigned_agent_id,
    agentName: agent?.name,
    queuePosition: position?.position,
    etaMinutes:
      row.status === "callback"
        ? minutesUntil(row.callback_at ?? undefined)
        : position?.etaMinutes,
    callbackAt: row.callback_at ?? undefined,
    message:
      row.status === "callback"
        ? "A callback was scheduled because no specialist was free."
        : row.status === "waiting"
          ? `Held on the line — position ${position?.position ?? 1} in the queue.`
          : row.status === "assigned"
            ? `Routed to ${agent?.name ?? "an agent"} — awaiting the human answer.`
            : "A human agent is live on this call.",
  }
}

export function listHandoffQueue(db: DatabaseSync): HandoffQueueItem[] {
  const rows = openHandoffs(db)
  const positions = waitingPositions(rows)
  const calls = listCalls(db)
  const byCall = new Map(calls.map((call) => [call.id, call]))

  const ordered = [...rows].sort((a, b) => {
    const rank: Record<string, number> = {
      accepted: 0,
      assigned: 1,
      waiting: 2,
      callback: 3,
    }
    const diff = rank[a.status] - rank[b.status]
    if (diff !== 0) return diff
    if (a.status === "waiting") {
      const w = severityWeight[b.severity as HandoffSeverity] -
        severityWeight[a.severity as HandoffSeverity]
      if (w !== 0) return w
    }
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  })

  const items: HandoffQueueItem[] = []
  for (const row of ordered) {
    const call = byCall.get(row.call_id)
    if (!call) continue
    const journey = getJourney(db, call.journeyId)
    const position = positions.get(row.call_id)
    const agent = row.assigned_agent_id
      ? agentById(db, row.assigned_agent_id)
      : null
    items.push({
      callId: row.call_id,
      callStatus: call.status,
      customerName: journey?.customerName ?? "Unknown",
      retailer: journey?.retailer ?? "",
      state: journey?.state ?? "",
      handoff: {
        reason: row.reason as HandoffReason,
        summary: row.summary,
        collected: JSON.parse(row.collected),
        remaining: JSON.parse(row.remaining),
        status: row.status as HandoffStatus,
        severity: row.severity as HandoffSeverity,
        ...(row.assigned_agent_id ? { assignedAgentId: row.assigned_agent_id } : {}),
        ...(agent?.name ? { assignedAgent: agent.name } : {}),
        ...(position
          ? { queuePosition: position.position, etaMinutes: position.etaMinutes }
          : {}),
        ...(row.status === "callback"
          ? { etaMinutes: minutesUntil(row.callback_at ?? undefined) }
          : {}),
        ...(row.accepted_at ? { acceptedAt: row.accepted_at } : {}),
        ...(row.callback_at ? { callbackAt: row.callback_at } : {}),
        ...(row.created_at ? { createdAt: row.created_at } : {}),
      },
    })
  }
  return items
}

// ---------------------------------------------------------------------------
// Lifecycle — the human agent console
// ---------------------------------------------------------------------------

/** Claim a queued/assigned handoff and take over the live call. */
export function acceptHandoff(
  db: DatabaseSync,
  callId: string,
  agentId: string
) {
  const agent = agentById(db, agentId)
  if (!agent) throw new Error("Agent not found")
  const row = openHandoffs(db).find((r) => r.call_id === callId)
  if (!row) throw new Error("No active handoff for this call")
  if (!["assigned", "waiting", "callback"].includes(row.status)) {
    throw new Error(`Cannot accept a handoff that is ${row.status}`)
  }
  if (
    agent.activeHandoffs >= agent.maxConcurrent &&
    row.assigned_agent_id !== agentId
  ) {
    throw new Error(`${agent.name} is already ${agent.activeHandoffs}/${agent.maxConcurrent} calls`)
  }

  updateHandoff(db, callId, {
    status: "accepted",
    assignedAgentId: agentId,
    acceptedAt: nowIso(),
    callbackAt: null,
  })
  setHumanAgentStatus(db, agentId, "busy")
  appendHandoffEvent(db, callId, "accepted", `Answered by ${agent.name}`)
}

/** The human finished the call — close it and free the agent's slot. */
export async function completeHandoff(db: DatabaseSync, callId: string) {
  const row = openHandoffs(db).find((r) => r.call_id === callId)
  if (!row) throw new Error("No active handoff for this call")

  updateHandoff(db, callId, { status: "completed" })
  updateCall(db, callId, {
    status: "completed",
    endedAt: nowIso(),
  })
  const call = listCalls(db).find((c) => c.id === callId) ?? null
  if (call) {
    const journey = getJourney(db, call.journeyId)
    if (journey) updateJourney(db, journey.id, { status: "completed" })
  }
  appendHandoffEvent(db, callId, "completed", "Closed by the human agent")

  if (row.assigned_agent_id) {
    const agent = agentById(db, row.assigned_agent_id)
    if (agent && agent.activeHandoffs <= 1) {
      setHumanAgentStatus(db, agent.id, "online")
    }
  }
  promoteNextWork(db)

  // The full conversation (AI + human part) goes through the quality auditor.
  try {
    const existing =
      listAudits(db).find((audit) => audit.leadId === callId) ?? null
    if (!existing) await runCallAudit(db, callId)
  } catch (error) {
    console.error(
      `[handoff] Post-call audit failed for ${callId}:`,
      error instanceof Error ? error.message : error
    )
  }
}

/** Bounce the call back into the queue (agent couldn't help / got interrupted). */
export function releaseHandoff(db: DatabaseSync, callId: string) {
  const row = openHandoffs(db).find((r) => r.call_id === callId)
  if (!row) throw new Error("No active handoff for this call")

  updateHandoff(db, callId, {
    status: "waiting",
    assignedAgentId: null,
    acceptedAt: null,
    callbackAt: null,
  })
  appendHandoffEvent(db, callId, "released", "Returned to the queue")

  if (row.assigned_agent_id) {
    const agent = agentById(db, row.assigned_agent_id)
    if (agent && agent.activeHandoffs <= 1) {
      setHumanAgentStatus(db, agent.id, "online")
    }
  }
  promoteNextWork(db)
}

/** Move a queued call to a scheduled callback (e.g. the customer could not hold). */
export function convertToCallback(db: DatabaseSync, callId: string) {
  const row = openHandoffs(db).find((r) => r.call_id === callId)
  if (!row) throw new Error("No active handoff for this call")
  if (row.status !== "waiting") throw new Error("Only queued calls can be converted")

  updateHandoff(db, callId, {
    status: "callback",
    callbackAt: callbackAt(),
  })
  updateCall(db, callId, { status: "callback", endedAt: nowIso() })
  appendHandoffEvent(
    db,
    callId,
    "callback",
    `Customer could not hold — callback scheduled within ${CALLBACK_SLA_MINUTES}m`
  )
}

/**
 * After an agent's slot frees, serve the most urgent waiting call first, then
 * promote the oldest pending callback to an active assignment.
 */
export function promoteNextWork(db: DatabaseSync) {
  for (let guard = 0; guard < 20; guard++) {
    const agents = eligibleAgents(db)
    if (agents.length === 0) break

    const rows = openHandoffs(db)
    const waiting = sortByUrgency(rows.filter((r) => r.status === "waiting"))
    let next = waiting[0] ?? null

    if (!next) {
      const callbacks = [...rows]
        .filter((r) => r.status === "callback")
        .sort((a, b) =>
          String(a.callback_at ?? "").localeCompare(String(b.callback_at ?? ""))
        )
      next = callbacks[0] ?? null
    }

    if (!next) break
    const agent = agents[0]
    updateHandoff(db, next.call_id, {
      status: "assigned",
      assignedAgentId: agent.id,
      callbackAt: null,
    })
    appendHandoffEvent(
      db,
      next.call_id,
      "assigned",
      `Slot freed — routed to ${agent.name}`
    )
    const call = listCalls(db).find((c) => c.id === next.call_id) ?? null
    if (call && call.status === "callback") {
      updateCall(db, next.call_id, { status: "handoff", endedAt: null })
    }
  }
}

// ---------------------------------------------------------------------------
// Agent availability
// ---------------------------------------------------------------------------

export function setAgentStatus(
  db: DatabaseSync,
  agentId: string,
  status: "online" | "away"
) {
  const agent = agentById(db, agentId)
  if (!agent) throw new Error("Agent not found")
  setHumanAgentStatus(db, agentId, status)
  if (status === "online") promoteNextWork(db)
}