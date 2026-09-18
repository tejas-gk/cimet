import type { DatabaseSync } from "node:sqlite"

import { getJourney, listAudits, listCalls, updateCall } from "@/lib/server/db"
import { runAudit } from "@/lib/server/auditor"
import { factsFromJourney } from "@/lib/server/call-audit"
import type { AuditRun } from "@/lib/cimet-ai-types"

export function requiredProviderEnv(key: string) {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`${key} is not configured`)
  return value
}

export function getCallAndJourney(db: DatabaseSync, callId: string) {
  const call = listCalls(db).find((item) => item.id === callId) ?? null
  if (!call) throw new Error("Call not found")
  const journey = getJourney(db, call.journeyId)
  if (!journey) throw new Error("Journey not found")
  if (journey.doNotCall) throw new Error("Journey is marked do-not-call")
  return { call, journey }
}

export async function auditManagedRecording(
  db: DatabaseSync,
  callId: string,
  recordingUrl: string,
  headers?: HeadersInit
): Promise<AuditRun | null> {
  const existing =
    listAudits(db).find((audit) => audit.leadId === callId) ?? null
  if (existing) return existing
  const call = listCalls(db).find((item) => item.id === callId) ?? null
  if (!call) throw new Error("Call not found")
  const facts = factsFromJourney(db, call.journeyId)
  if (!facts) throw new Error("Journey not found")
  const res = await fetch(recordingUrl, { headers })
  if (!res.ok)
    throw new Error(`Failed to download phone recording (${res.status})`)
  const { audit } = await runAudit({
    audio: Buffer.from(await res.arrayBuffer()),
    source: "voice-call",
    persistAudio: true,
    leadId: callId,
    attributes: facts,
  })
  return audit
}

export function markDialStarted(db: DatabaseSync, callId: string) {
  updateCall(db, callId, { status: "ringing" })
  return listCalls(db).find((item) => item.id === callId)!
}

export function markDialEnded(
  db: DatabaseSync,
  callId: string,
  status: "completed" | "declined" | "handoff"
) {
  updateCall(db, callId, { status, endedAt: new Date().toISOString() })
}
