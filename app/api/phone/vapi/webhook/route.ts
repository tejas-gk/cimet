import { getDb } from "@/lib/server/db"
import { handle, json } from "@/lib/server/http"
import {
  handleManagedWebhook,
  parseWebhookPayload,
} from "@/lib/server/phone/webhook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = handle(async (req: Request) => {
  const payload = await parseWebhookPayload(req)
  const audit = payload
    ? await handleManagedWebhook(getDb(), payload, {
        Authorization: `Bearer ${process.env.VAPI_API_KEY ?? ""}`,
      })
    : null
  return json({ data: audit })
})
