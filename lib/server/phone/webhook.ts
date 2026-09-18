import type { DatabaseSync } from "node:sqlite"

import {
  auditManagedRecording,
  markDialEnded,
} from "@/lib/server/phone/managed"

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function firstString(...values: unknown[]) {
  return values.map(str).find(Boolean) ?? ""
}

export async function parseWebhookPayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? ""
  if (contentType.includes("application/json"))
    return (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
  const form = await req.formData()
  const payload = str(form.get("payload"))
  if (payload) return JSON.parse(payload) as Record<string, unknown>
  return Object.fromEntries(form.entries()) as Record<string, unknown>
}

export async function handleManagedWebhook(
  db: DatabaseSync,
  payload: Record<string, unknown>,
  authHeaders?: HeadersInit
) {
  const call = asRecord(payload.call)
  const data = asRecord(payload.data)
  const metadata =
    asRecord(payload.metadata) ??
    asRecord(call?.metadata) ??
    asRecord(data?.metadata)
  const callId = firstString(
    payload.callId,
    payload.call_id,
    metadata?.callId,
    metadata?.call_id
  )
  if (!callId) return null

  const status = firstString(
    payload.status,
    payload.call_status,
    payload.endedReason,
    data?.status,
    call?.status
  )
  const recordingUrl = firstString(
    payload.recordingUrl,
    payload.recording_url,
    data?.recordingUrl,
    data?.recording_url,
    call?.recordingUrl,
    call?.recording_url
  )

  if (
    [
      "failed",
      "busy",
      "no-answer",
      "canceled",
      "error",
      "not_connected",
    ].includes(status)
  ) {
    markDialEnded(db, callId, "declined")
  } else if (["ended", "completed", "done"].includes(status) || recordingUrl) {
    markDialEnded(db, callId, "completed")
  }

  if (!recordingUrl) return null
  return auditManagedRecording(db, callId, recordingUrl, authHeaders)
}
