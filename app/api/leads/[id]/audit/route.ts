import { NextResponse } from "next/server"
import { getDb, getLeadRecording, saveLeadRecording } from "@/lib/server/db"
import { runAudit } from "@/lib/server/auditor"
import { leadRecordingsDir } from "@/lib/server/auditor"
import fs from "node:fs"
import path from "node:path"
import { listPlans } from "@/lib/server/db"

const ALLOWED_EXT = new Set([".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"])
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

function buildLeadFacts(rec: ReturnType<typeof getLeadRecording>): any {
  return {
    leadName: rec.filename,
    agentName: "Maya",
    retailer: "",
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid lead id." }, { status: 400 })
  }

  const rec = getLeadRecording(getDb(), id)
  if (!rec) {
    return NextResponse.json({ error: "Recording not found for this lead." }, { status: 404 })
  }

  const audioPath = path.join(process.cwd(), "data", "lead-recordings", rec.filename)
  if (!fs.existsSync(audioPath)) {
    return NextResponse.json({ error: "Audio file not found." }, { status: 404 })
  }

  const audio = fs.readFileSync(audioPath)
  if (audio.length === 0) {
    return NextResponse.json({ error: "Audio file is empty." }, { status: 400 })
  }

  const db = getDb()
  const planDefs = listPlans(db)

  // Build facts from the lead recording
  const facts = buildLeadFacts(rec)

  // Run the quality audit
  try {
    const result = await runAudit({
      audio,
      source: "upload",
      attributes: facts,
      persistAudio: true,
      leadId: id,
    })
    return NextResponse.json({
      auditId: result.audit.id,
      status: result.audit.status,
      confidence: result.audit.confidence,
      aiSummary: result.audit.aiSummary,
    })
  } catch (error: any) {
    console.error(`[lead-audit] Audit failed for lead ${id}:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Audit failed." },
      { status: 500 }
    )
  }
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

  // Return recording info and audit status if available
  const db = getDb()
  const audit = db.prepare(
    "SELECT * FROM audits WHERE lead_id = ?"
  ).get(id) as any

  return NextResponse.json({
    recording: {
      filename: rec.filename,
      mime: rec.mime,
      durationMs: rec.durationMs,
      humanInteracted: rec.humanInteracted,
    },
    audit: audit ? {
      id: audit.id,
      status: audit.status,
      confidence: audit.confidence,
      aiSummary: audit.aiSummary,
    } : null,
  })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  if (!ID_PATTERN.test(id)) {
    return new Response("Bad request", { status: 400 })
  }

  const body = await request.json()
  const { humanInteracted } = body

  if (typeof humanInteracted !== "boolean") {
    return new Response("Invalid humanInteracted value", { status: 400 })
  }

  db.prepare(
    `UPDATE lead_recordings SET human_interacted = ? WHERE lead_id = ?`
  ).run(humanInteracted ? 1 : 0, id)

  const updatedRec = getLeadRecording(getDb(), id)
  return NextResponse.json({
    humanInteracted: updatedRec?.humanInteracted ?? false,
  })
}