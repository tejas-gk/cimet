import { getDb } from "@/lib/server/db"
import { apiError, handle, json } from "@/lib/server/http"
import { getPhoneProvider } from "@/lib/server/phone"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const body = (await req.json().catch(() => null)) as {
      provider?: string
    } | null
    const db = getDb()
    try {
      const provider = getPhoneProvider(body?.provider)
      const result = await provider.dial(db, id)
      return json({ data: result })
    } catch (error) {
      if (error instanceof Error && error.message === "Call not found") {
        return apiError("Call not found", 404, "not_found")
      }
      throw error
    }
  }
)
