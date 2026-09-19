import { getDb, upsertHumanAgent } from "@/lib/server/db"
import { handle, json, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(async (req: Request) => {
    const body = (await req.json().catch(() => null)) as {
        id?: string
        name?: string
        role?: string
        maxConcurrent?: number
    } | null
    if (!body?.id || !body?.name || !body?.role)
        return apiError("id, name and role are required", 400, "missing_fields")
    const db = getDb()
    upsertHumanAgent(db, {
        id: body.id,
        name: body.name,
        role: body.role,
        maxConcurrent: body.maxConcurrent ?? 1,
    })
    return json({ data: { ok: true } })
})
