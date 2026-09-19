import { getDb } from "@/lib/server/db"
import { handle, json } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const db = getDb()
    const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(id)
    if (!call) return json({ data: { fields: {} } })

    const fields = db
      .prepare("SELECT * FROM journey_fields WHERE journey_id = ?")
      .all(call.journey_id)

    const fieldMap: Record<string, string> = {}
    for (const field of fields) {
      if (field.value) {
        fieldMap[String(field.field_key)] = String(field.value)
      }
    }

    return json({ data: { fields: fieldMap } })
  }
)
