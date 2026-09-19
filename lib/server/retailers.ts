/**
 * Retailer source-of-truth product data used by the AI Quality Auditor for
 * factual checks. In production this feed would come from each retailer's
 * tariff/plan catalogue; the auditors compare what the agent said on the call
 * against these authoritative values.
 */

export type RetailerProduct = {
  id: string
  name: string
  /** Peak electricity rate in cents per kWh (our audit compares spoken rates). */
  peakRateCents: number
  /** Whether the agent is legally required to ask about a concession card. */
  concessionDisclosureRequired: boolean
  /** The required call opening used in the script check. */
  mandatoryOpening?: string
}

export const retailerProducts: Record<string, RetailerProduct> = {
  energyaustralia: {
    id: "energyaustralia",
    name: "EnergyAustralia",
    peakRateCents: 31.9,
    concessionDisclosureRequired: true,
    mandatoryOpening: "recorded for quality, training or compliance",
  },
  agl: {
    id: "agl",
    name: "AGL",
    peakRateCents: 30.2,
    concessionDisclosureRequired: true,
    mandatoryOpening: "recorded for quality, training or compliance",
  },
  origin: {
    id: "origin",
    name: "Origin",
    peakRateCents: 29.8,
    concessionDisclosureRequired: true,
    mandatoryOpening: "recorded for quality, training or compliance",
  },
}

export function retailerByName(name: string): RetailerProduct | null {
  const key = name.toLowerCase().replace(/[^a-z]/g, "")
  return retailerProducts[key] ?? null
}
