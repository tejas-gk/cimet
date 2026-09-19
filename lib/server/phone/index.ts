import type { PhoneProviderId } from "@/lib/server/phone/types"
import { exotelPhoneProvider } from "@/lib/server/phone/exotel"
import { retellPhoneProvider } from "@/lib/server/phone/retell"
import { twilioPhoneProvider } from "@/lib/server/phone/twilio"
import { vapiPhoneProvider } from "@/lib/server/phone/vapi"
import { plivoPhoneProvider } from "@/lib/server/phone/plivo"

export const phoneProviders = [
    twilioPhoneProvider,
    retellPhoneProvider,
    vapiPhoneProvider,
    plivoPhoneProvider,
    exotelPhoneProvider,
]

export function getPhoneProvider(
  id: string | null | undefined = process.env.PHONE_PROVIDER
) {
  const providerId = (id || "twilio") as PhoneProviderId
  return (
    phoneProviders.find((provider) => provider.id === providerId) ??
    twilioPhoneProvider
  )
}
