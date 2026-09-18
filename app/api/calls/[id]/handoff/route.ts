import { getDb } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"
import { triggerHandoff } from "@/lib/server/voice-agent"
import type { HandoffReason } from "@/lib/cimet-ai-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_REASONS: HandoffReason[] = [
  "asked-for-human",
  "angry-customer",
  "low-confidence",
  "out-of-scope",
  "sensitive-topic",
  "repeated-misunderstanding",
]

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/calls/[id]/handoff">) => {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as { reason?: string } | null
  const reason = body?.reason ?? ""
  if (!VALID_REASONS.includes(reason as HandoffReason)) {
    return apiError("Invalid handoff reason", 400, "invalid_reason")
  }

  const db = getDb()
  try {
    const call = triggerHandoff(db, id, reason as HandoffReason)
    return json({ data: call })
  } catch (error) {
    if (error instanceof Error && error.message === "Call not found") {
      return apiError("Call not found", 404, "not_found")
    }
    throw error
  }
})