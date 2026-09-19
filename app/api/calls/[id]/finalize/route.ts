import { getDb } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(
    async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params
        const db = getDb()
        const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(id)
        if (!call) return apiError("Call not found", 404, "not_found")

        // Return current journey fields so client can merge into lead draft
        const fields = db
            .prepare("SELECT field_key, value FROM journey_fields WHERE journey_id = ?")
            .all(call.journey_id)

        const map: Record<string, string> = {}
        for (const f of fields) {
            if (f.value) map[String(f.field_key)] = String(f.value)
        }
        return json({ data: { fields: map } })
    }
)
