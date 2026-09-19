import fs from "node:fs"
import path from "node:path"

import { NextResponse } from "next/server"

import { getDb, getLeadRecording, saveLeadRecording } from "@/lib/server/db"
import {
  SarvamApiError,
  speechToText,
  type SpeechToTextChunk,
} from "@/lib/server/sarvam"
import type { TranscriptSegment } from "@/lib/leads-store"

const AUDIO_DIR = path.join(process.cwd(), "data", "lead-recordings")
const ALLOWED_EXT = new Set([".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"])
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

function mimeFor(ext: string): string {
  switch (ext) {
    case ".wav":
      return "audio/wav"
    case ".mp3":
      return "audio/mpeg"
    case ".m4a":
      return "audio/mp4"
    case ".ogg":
      return "audio/ogg"
    case ".flac":
      return "audio/flac"
    case ".webm":
      return "audio/webm"
    default:
      return "application/octet-stream"
  }
}

function buildSegments(
  chunks: SpeechToTextChunk[],
  fallbackText: string
): TranscriptSegment[] {
  if (chunks.length === 0) {
    const text = fallbackText.trim()
    return text
      ? [{ id: "seg-0", speaker: "customer", text, startMs: 0, endMs: 0 }]
      : []
  }
  const segments: TranscriptSegment[] = []
  let buffer: SpeechToTextChunk[] = []

  const flush = () => {
    if (buffer.length === 0) return
    const text = buffer
      .map((c) => c.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    if (!text) {
      buffer = []
      return
    }
    segments.push({
      id: `seg-${segments.length}`,
      speaker: "customer",
      text,
      startMs: buffer[0].startMs,
      endMs: buffer[buffer.length - 1].endMs,
    })
    buffer = []
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    buffer.push(chunk)
    const accumulated = buffer
      .map((c) => c.text)
      .join(" ")
      .trim()
    const next = chunks[i + 1]
    if (
      /[.!?]…?$/.test(accumulated) ||
      accumulated.length >= 160 ||
      buffer.length >= 18 ||
      (next && next.startMs - chunk.endMs > 800)
    ) {
      flush()
    }
  }
  flush()
  return segments
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form body." },
      { status: 400 }
    )
  }

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "A file upload field named 'file' is required." },
      { status: 400 }
    )
  }

  const humanInteracted = form.get("humanInteracted") ? Boolean(form.get("humanInteracted")) : false

  const ext = path.extname(file.name || "recording.wav").toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      {
        error: `Unsupported file type "${ext}". Use wav, mp3, m4a, ogg, flac or webm.`,
      },
      { status: 415 }
    )
  }

  const audio = Buffer.from(await file.arrayBuffer())
  if (audio.byteLength === 0) {
    return NextResponse.json(
      { error: "The uploaded file is empty." },
      { status: 400 }
    )
  }

  const mime = file.type || mimeFor(ext)
  const language = form.get("language") ? String(form.get("language")) : "en-IN"

  let segments: TranscriptSegment[] = []
  let requestId: string | undefined
  try {
    const result = await speechToText({
      audio,
      filename: file.name || `recording${ext}`,
      mime,
      languageCode: language,
      timeoutMs: 120_000,
    })
    segments = buildSegments(result.chunks, result.transcript)
    requestId = result.requestId
  } catch (error) {
    if (error instanceof SarvamApiError) {
      return NextResponse.json(
        { error: error.message, requestId: error.requestId ?? requestId },
        { status: error.status > 0 ? error.status : 500 }
      )
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Transcription failed.",
      },
      { status: 500 }
    )
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "_")
  const storageName = `${safeId}${ext}`
  fs.writeFileSync(path.join(AUDIO_DIR, storageName), audio)

  const db = getDb()
  saveLeadRecording(db, {
    leadId: id,
    filename: storageName,
    mime,
    durationMs: null,
    transcript: segments,
    humanInteracted,
  })

  return NextResponse.json({
    recordingUrl: `/api/leads/${encodeURIComponent(id)}/recording`,
    transcript: segments,
    requestId,
  })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!ID_PATTERN.test(id)) {
    return new Response("Bad request", { status: 400 })
  }

  const rec = getLeadRecording(getDb(), id)
  if (!rec) {
    return new Response("Not found", { status: 404 })
  }

  try {
    const buffer = await fs.promises.readFile(
      path.join(AUDIO_DIR, rec.filename)
    )
    return new Response(new Uint8Array(buffer as Buffer), {
      headers: {
        "Content-Type": rec.mime,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "public, max-age=3600",
        "Accept-Ranges": "none",
      },
    })
  } catch {
    return new Response("Recording file missing", { status: 404 })
  }
}
