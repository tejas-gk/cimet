import { getDb } from "@/lib/server/db"
import { apiError, handle } from "@/lib/server/http"
import { getPhoneProvider } from "@/lib/server/phone"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(
    async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params
        const form = await req.formData()
        try {
            const result = await getPhoneProvider("exotel").turnTwiml(
                getDb(),
                id,
                String(form.get("SpeechResult") ?? "")
            )
            return new Response(result.twiml, {
                headers: { "Content-Type": "text/xml" },
            })
        } catch (error) {
            if (error instanceof Error && error.message === "Call not found")
                return apiError("Call not found", 404, "not_found")
            throw error
        }
    }
)
