"use client"

export type TranscriptSegment = {
  id: string
  speaker: "agent" | "customer"
  text: string
  startMs: number
  endMs: number
}

export type QaStatus = "pending" | "auto-pass" | "hold" | "human-review"

export type Lead = {
  id: string
  name: string
  email: string
  phone: string
  company: string
  state: string
  retailer: string
  plan: string
  usage: string
  message: string
  consent: boolean
  // Energy facts the Quality Auditor cross-checks against the call.
  address: string
  postcode: string
  dob: string
  fuelType: string
  nmiMirn: string
  concession: string
  lifeSupport: string
  moveInDate: string
  submitted: boolean
  lastStep: number
  createdAt: number
  updatedAt: number
  recordingUrl: string | null
  transcript: TranscriptSegment[]
  // Latest quality-audit result for this lead.
  qaStatus: QaStatus
  qaAuditId: string | null
  qaSummary: string | null
  qaConfidence: number | null
}

export const STORAGE_KEY = "cimet-leads-v3"
export const LEADS_CHANGED_EVENT = "cimet:leads-changed"

export const ENERGY_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"]
export const RETAILERS = ["EnergyAustralia", "AGL", "Origin"]
export const ENERGY_PLANS = ["Standard plan", "Fixed 12-month", "Solar buy-back", "Broadband bundle"]
export const FUEL_TYPES = ["Electricity", "Gas"]
export const USAGE_TIERS = ["Under $150 / month", "$150 - $300 / month", "$300 - $600 / month", "Over $600 / month"]
export const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
]

export function localLeadId() {
  return `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function emptyLead(): Lead {
  const now = Date.now()
  return {
    id: localLeadId(),
    name: "",
    email: "",
    phone: "",
    company: "",
    state: "",
    retailer: "",
    plan: "",
    usage: "",
    message: "",
    consent: false,
    address: "",
    postcode: "",
    dob: "",
    fuelType: "",
    nmiMirn: "",
    concession: "",
    lifeSupport: "",
    moveInDate: "",
    submitted: false,
    lastStep: 0,
    createdAt: now,
    updatedAt: now,
    recordingUrl: null,
    transcript: [],
    qaStatus: "pending",
    qaAuditId: null,
    qaSummary: null,
    qaConfidence: null,
  }
}

const progressFields: Array<keyof Pick<
  Lead,
  | "name" | "email" | "phone" | "company" | "state" | "retailer" | "plan"
  | "usage" | "message" | "address" | "postcode" | "dob" | "fuelType"
  | "nmiMirn" | "concession" | "lifeSupport" | "moveInDate"
>> = [
  "name", "email", "phone", "company", "state", "retailer", "plan", "usage",
  "message", "address", "postcode", "dob", "fuelType", "nmiMirn",
  "concession", "lifeSupport", "moveInDate",
]

export function leadProgress(lead: Pick<Lead, (typeof progressFields)[number]>) {
  const values = progressFields.map((field) => lead[field])
  const filled = values.filter((value) => String(value ?? "").trim().length > 0).length
  return Math.round((filled / values.length) * 100)
}

export function loadLeads(): Lead[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Lead[]
    const leads = Array.isArray(parsed) ? parsed : []
    return leads.map((lead) => ({
      ...emptyLead(),
      ...lead,
      recordingUrl: lead.recordingUrl ?? null,
      transcript: Array.isArray(lead.transcript) ? lead.transcript : [],
      qaStatus: lead.qaStatus ?? "pending",
      qaAuditId: lead.qaAuditId ?? null,
      qaSummary: lead.qaSummary ?? null,
      qaConfidence: lead.qaConfidence ?? null,
    }))
  } catch {
    return []
  }
}

export function saveLeads(leads: Lead[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads))
  window.dispatchEvent(new CustomEvent(LEADS_CHANGED_EVENT))
}