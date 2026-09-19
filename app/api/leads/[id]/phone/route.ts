import {
  createLeadCall,
  type LeadDialFacts,
} from "@/lib/server/phone/lead-call"
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
      lead?: Partial<LeadDialFacts>
    } | null

    if (!body?.lead) {
      return apiError("Missing lead data", 400, "bad_request")
    }
    if (!body.lead.phone) {
      return apiError("Lead has no phone number", 400, "bad_request")
    }

    const db = getDb()
    const { journeyId, callId } = createLeadCall(db, {
      id,
      name: body.lead.name ?? "",
      phone: body.lead.phone,
      email: body.lead.email ?? "",
      retailer: body.lead.retailer ?? "",
      state: body.lead.state ?? "",
      address: body.lead.address ?? "",
      postcode: body.lead.postcode ?? "",
      dob: body.lead.dob ?? "",
      fuelType: body.lead.fuelType ?? "",
      nmiMirn: body.lead.nmiMirn ?? "",
      concession: body.lead.concession ?? "",
      lifeSupport: body.lead.lifeSupport ?? "",
      moveInDate: body.lead.moveInDate ?? "",
    })

    const provider = getPhoneProvider(body.provider)
    const result = await provider.dial(db, callId)
    return json({ data: { ...result, journeyId, callId } })
  }
)
