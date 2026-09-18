import { getDb } from "@/lib/server/db"
import { handle, json } from "@/lib/server/http"
import { getPhoneProvider } from "@/lib/server/phone"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    await getPhoneProvider("twilio").status(getDb(), id, await req.formData())
    return json({ data: { ok: true } })
  }
)
