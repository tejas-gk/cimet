import { getDb } from "@/lib/server/db"
import { apiError, handle } from "@/lib/server/http"
import { getPhoneProvider } from "@/lib/server/phone"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function twiml(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    return new Response(
      await getPhoneProvider("twilio").initialTwiml(getDb(), id),
      {
        headers: { "Content-Type": "text/xml" },
      }
    )
  } catch (error) {
    if (error instanceof Error && error.message === "Call not found")
      return apiError("Call not found", 404, "not_found")
    throw error
  }
}

export const GET = handle(twiml)
export const POST = handle(twiml)
