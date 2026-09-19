import { NextResponse } from "next/server"
import fs from "node:fs"
import path from "node:path"

import { getDb, saveLeadRecording } from "@/lib/server/db"

const ALLOWED_EXT = new Set(["wav", "mp3", "m4a", "ogg", "flac", "webm"])
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 })
  }

  const body = await request.json()
  const { base64, mime, humanInteracted } = body

  if (!base64) {
    return NextResponse.json({ error: "Base64 audio is required." }, { status: 400 })
  }

  const audioBuffer = Buffer.from(base64, "base64")
  if (audioBuffer.length === 0) {
    return NextResponse.json({ error: "Audio data is empty." }, { status: 400 })
  }

  const ext = (mime || "").replace("audio/", "").replace(";", "")
  const allowedExt = new Set(["wav", "mp3", "m4a", "ogg", "flac", "webm"])
  if (!allowedExt.has(ext)) {
    return NextResponse.json(
      { error: `Unsupported mime type "${mime}".` },
      { status: 415 }
    )
  }

  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "_")
  const storageName = `${safeId}.wav`
  const audioDir = path.join(process.cwd(), "data", "lead-recordings")
  
  // Ensure directory exists
  import fs from "node:fs"
  fs.mkdirSync(audioDir, { recursive: true })
  
  fs.writeFileSync(path.join(audioDir, storageName), audioBuffer)

  const db = getDb()
  saveLeadRecording(db, {
    leadId: id,
    filename: storageName,
    mime: `audio/${ext}`,
    durationMs: audioBuffer.length,
    transcript: [],
    humanInteracted,
  })

  return NextResponse.json({
    recordingUrl: `/api/leads/${encodeURIComponent(id)}/recording`,
    humanInteracted,
  })
}