/**
 * QA data model for Project 2: plans and per-retailer check libraries.
 *
 * This is the typed source-of-truth.  db.ts mirrors it into SQLite tables
 * (plans + audit_check_defs) so the checklist is queryable as a real table.
 * The auditor reads from these typed constants to stay simple and type-safe.
 */

import { retailerByName } from "@/lib/server/retailers"

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type QaPlan = {
  planId: string
  retailer: string
  peakRateCents: number
  supplyChargeCents: number
  giftCardDollars: number
  concessionDisclosureRequired: boolean
  recordingDisclaimer: string
}

export const qaPlans: QaPlan[] = [
  {
    planId: "ENERGY_SAVER",
    retailer: "EnergyAustralia",
    peakRateCents: 31.9,
    supplyChargeCents: 105,
    giftCardDollars: 100,
    concessionDisclosureRequired: true,
    recordingDisclaimer: "this call is recorded for quality and compliance",
  },
  {
    planId: "SMART_VALUE",
    retailer: "AGL",
    peakRateCents: 30.2,
    supplyChargeCents: 102,
    giftCardDollars: 80,
    concessionDisclosureRequired: true,
    recordingDisclaimer: "this call is recorded for quality and compliance",
  },
  {
    planId: "SOLAR_BUNDLE",
    retailer: "Origin",
    peakRateCents: 29.8,
    supplyChargeCents: 98,
    giftCardDollars: 120,
    concessionDisclosureRequired: true,
    recordingDisclaimer: "this call is recorded for quality and compliance",
  },
]

export function planForRetailer(retailer: string): QaPlan {
  const key = retailer.toLowerCase().replace(/[^a-z]/g, "")
  return (
    qaPlans.find(
      (p) => p.retailer.toLowerCase().replace(/[^a-z]/g, "") === key,
    ) ?? {
      planId: "UNKNOWN",
      retailer: retailer || "Unknown",
      peakRateCents: 0,
      supplyChargeCents: 0,
      giftCardDollars: 0,
      concessionDisclosureRequired: false,
      recordingDisclaimer: "this call is recorded",
    }
  )
}

// ---------------------------------------------------------------------------
// Check definitions per retailer
// ---------------------------------------------------------------------------

export type FactTarget =
  | { kind: "lead"; field: string }
  | { kind: "plan"; field: string }

export type QaCheckDef = {
  key: string
  label: string
  category: "script" | "fact" | "behaviour"
  critical: boolean
  /** Behaviour checks that are coaching-only and never block a sale. */
  coachingOnly?: boolean
  /** Fact check only — gate on this lead field being non-empty. */
  leadField?: string
  /** Script verbatim: the approved wording to fuzzy-match against. */
  verbatim?: string
  /** Script semantic: prompt the LLM to classify whether a requirement was met. */
  semanticPrompt?: string
  /** Fact extraction: field name the LLM extracts from the transcript. */
  extractAs?: string
  /** Fact comparison: how to normalize both spoken + expected values. */
  normalize?: NormalizeKind
  /** Where the expected value comes from. */
  source?: FactTarget
}

type NormalizeKind = import("./similarity").NormalizeKind

export const scriptChecks: QaCheckDef[] = [
  {
    key: "recording-disclaimer",
    label: "Recording disclaimer was stated",
    category: "script",
    critical: true,
    verbatim: "this call is recorded for quality and compliance",
  },
  {
    key: "concession-disclosure",
    label: "Agent asked about concession card eligibility",
    category: "script",
    critical: true,
    semanticPrompt:
      "Did the sales agent ask the customer whether they hold a concession card? " +
      "Look for any question or request for information about concession card status. " +
      'Return "yes" if the agent clearly asked, "no" if not asked, or "partial" if vague.',
  },
]

export const factChecks: QaCheckDef[] = [
  {
    key: "peak-rate",
    label: "Peak electricity rate matches plan data",
    category: "fact",
    critical: true,
    extractAs: "peakRate",
    normalize: "float",
    source: { kind: "plan", field: "peakRateCents" },
  },
  {
    key: "email-confirmation",
    label: "Customer email matches CRM record",
    category: "fact",
    critical: true,
    leadField: "customerEmail",
    extractAs: "email",
    normalize: "email",
    source: { kind: "lead", field: "customerEmail" },
  },
  {
    key: "address-match",
    label: "Customer address matches CRM record",
    category: "fact",
    critical: true,
    leadField: "address",
    extractAs: "address",
    normalize: "address",
    source: { kind: "lead", field: "address" },
  },
  {
    key: "postcode-match",
    label: "Postcode matches CRM record",
    category: "fact",
    critical: true,
    leadField: "postcode",
    extractAs: "postcode",
    normalize: "postcode",
    source: { kind: "lead", field: "postcode" },
  },
  {
    key: "dob-match",
    label: "Date of birth matches CRM record",
    category: "fact",
    critical: true,
    leadField: "dob",
    extractAs: "dob",
    normalize: "date",
    source: { kind: "lead", field: "dob" },
  },
  {
    key: "nmi-mirn",
    label: "NMI/MIRN matches CRM record",
    category: "fact",
    critical: true,
    leadField: "nmiMirn",
    extractAs: "nmiMirn",
    normalize: "digits",
    source: { kind: "lead", field: "nmiMirn" },
  },
  {
    key: "fuel-type",
    label: "Fuel type matches CRM record",
    category: "fact",
    critical: true,
    leadField: "fuelType",
    extractAs: "fuelType",
    normalize: "text",
    source: { kind: "lead", field: "fuelType" },
  },
  {
    key: "concession-stated",
    label: "Concession status matches CRM record",
    category: "fact",
    critical: true,
    leadField: "concession",
    extractAs: "concession",
    normalize: "boolean",
    source: { kind: "lead", field: "concession" },
  },
  {
    key: "life-support",
    label: "Life-support status matches CRM record",
    category: "fact",
    critical: true,
    leadField: "lifeSupport",
    extractAs: "lifeSupport",
    normalize: "boolean",
    source: { kind: "lead", field: "lifeSupport" },
  },
  {
    key: "move-in-date",
    label: "Move-in date matches CRM record",
    category: "fact",
    critical: true,
    leadField: "moveInDate",
    extractAs: "moveInDate",
    normalize: "date",
    source: { kind: "lead", field: "moveInDate" },
  },
]

export const behaviourChecks: QaCheckDef[] = [
  {
    key: "dead-air",
    label: "Excessive dead air detected",
    category: "behaviour",
    critical: false,
    coachingOnly: true,
  },
  {
    key: "interruptions",
    label: "Speaker interruptions detected",
    category: "behaviour",
    critical: false,
    coachingOnly: true,
  },
  {
    key: "rapport-objection",
    label: "Rapport and objection handling",
    category: "behaviour",
    critical: false,
    coachingOnly: true,
  },
]

/**
 * Return the full set of checks that apply for a given retailer + lead facts.
 * Script verbatim disclaimer wording comes from the plan.
 */
export function checkDefsFor(
  retailer: string,
  facts: Record<string, string | undefined>,
): QaCheckDef[] {
  const plan = planForRetailer(retailer)
  const defs: QaCheckDef[] = []

  for (const def of scriptChecks) {
    if (def.key === "recording-disclaimer") {
      defs.push({ ...def, verbatim: plan.recordingDisclaimer })
    } else if (def.key === "concession-disclosure") {
      if (plan.concessionDisclosureRequired) defs.push(def)
    } else {
      defs.push(def)
    }
  }

  for (const def of factChecks) {
    if (!def.leadField || (facts[def.leadField] ?? "").trim()) {
      defs.push(def)
    }
  }

  defs.push(...behaviourChecks)
  return defs
}
