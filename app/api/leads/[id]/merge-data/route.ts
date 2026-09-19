import { getDb } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function shortId(id: string) {
    return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12)
}

export const POST = handle(
    async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params
        const body = (await req.json().catch(() => null)) as
            | { fields?: Record<string, string> }
            | null

        if (!body || !body.fields || typeof body.fields !== "object") {
            return apiError("Missing fields", 400, "invalid_body")
        }

        const db = getDb()
        const journeyId = `journey-lead-${shortId(id)}`
        const journey = db
            .prepare("SELECT id FROM journeys WHERE id = ?")
            .get(journeyId)
        if (!journey) {
            return apiError("Journey not found for lead", 404, "not_found")
        }

        try {
            db.exec("BEGIN TRANSACTION")
            for (const [key, value] of Object.entries(body.fields)) {
                if (!value || String(value).trim().length === 0) continue
                // write value as collected by AI
                db.prepare(
                    `UPDATE journey_fields SET value = ?, collected_by = ? WHERE journey_id = ? AND field_key = ?`
                ).run(String(value), "ai", journeyId, key)
            }
            db.exec("COMMIT")
            return json({ data: { ok: true } })
        } catch (error) {
            db.exec("ROLLBACK")
            throw error
        }
    }
)
