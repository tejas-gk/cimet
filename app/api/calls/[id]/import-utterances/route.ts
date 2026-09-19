import { getDb } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(
    async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params
        const body = (await req.json().catch(() => null)) as
            | { utterances?: Array<{ speaker: string; text: string; startMs?: number }> }
            | null

        if (!body || !Array.isArray(body.utterances)) {
            return apiError("Missing utterances array", 400, "invalid_body")
        }

        const db = getDb()
        const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(id)
        if (!call) return apiError("Call not found", 404, "not_found")

        try {
            db.exec("BEGIN TRANSACTION")
            let nextStart = db
                .prepare("SELECT end_ms FROM utterances WHERE call_id = ? ORDER BY end_ms DESC LIMIT 1")
                .get(id)?.end_ms ?? 0
            for (const u of body.utterances) {
                const start = typeof u.startMs === "number" ? u.startMs : nextStart + 500
                const duration = Math.max(800, String(u.text || "").length * 45)
                const end = start + duration
                db.prepare(
                    `INSERT INTO utterances (id, call_id, speaker, text, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?)`
                ).run(crypto.randomUUID(), id, String(u.speaker), String(u.text), start, end)
                nextStart = end + 200
            }
            db.exec("COMMIT")
            return json({ data: { ok: true } })
        } catch (error) {
            db.exec("ROLLBACK")
            throw error
        }
    }
)
