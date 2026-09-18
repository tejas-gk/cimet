import type { AuditRun, CallSession, EnergyJourney, Utterance } from "@/lib/cimet-ai-types"

export const demoJourneys: EnergyJourney[] = [
  {
    id: "journey-1001",
    customerName: "Alice Johnson",
    phone: "+61 412 555 010",
    email: "alice@acme.com",
    retailer: "EnergyAustralia",
    state: "NSW",
    status: "dropped",
    abandonStep: "Move-in details",
    doNotCall: false,
    fields: [
      { key: "postcode", label: "Postcode", value: "2000", required: true, collectedBy: "customer" },
      { key: "propertyType", label: "Property type", value: "Apartment", required: true, collectedBy: "customer" },
      { key: "moveInDate", label: "Move-in date", value: null, required: true },
      { key: "lifeSupport", label: "Life support equipment", value: null, required: true },
      { key: "currentRetailer", label: "Current retailer", value: null, required: false },
    ],
  },
  {
    id: "journey-1002",
    customerName: "Bob Martinez",
    phone: "+61 421 555 013",
    email: "bob@globex.com",
    retailer: "AGL",
    state: "VIC",
    status: "calling",
    abandonStep: "Usage estimate",
    doNotCall: false,
    fields: [
      { key: "postcode", label: "Postcode", value: "3000", required: true, collectedBy: "customer" },
      { key: "propertyType", label: "Property type", value: "House", required: true, collectedBy: "customer" },
      { key: "usage", label: "Estimated quarterly usage", value: null, required: true },
      { key: "solar", label: "Solar installed", value: null, required: true },
    ],
  },
  {
    id: "journey-1003",
    customerName: "Carol Nguyen",
    phone: "+61 430 555 019",
    email: "carol@initech.com",
    retailer: "Origin",
    state: "QLD",
    status: "handoff",
    abandonStep: "Plan confirmation",
    doNotCall: false,
    fields: [
      { key: "postcode", label: "Postcode", value: "4000", required: true, collectedBy: "customer" },
      { key: "moveInDate", label: "Move-in date", value: "22 Sep 2026", required: true, collectedBy: "ai" },
      { key: "concession", label: "Concession card", value: null, required: true },
    ],
  },
]

export const demoCalls: CallSession[] = [
  {
    id: "call-1001",
    journeyId: "journey-1001",
    status: "queued",
    consentRecorded: false,
    safetyScore: 98,
    provider: "mock",
    utterances: [],
  },
  {
    id: "call-1002",
    journeyId: "journey-1002",
    status: "collecting",
    consentRecorded: true,
    safetyScore: 86,
    provider: "mock",
    currentQuestionKey: "usage",
    startedAt: "2026-09-18T06:00:00.000Z",
    utterances: [
      { id: "utt-1002-1", speaker: "ai", startMs: 0, endMs: 5200, text: "Hi Bob, this is CIMET's virtual assistant calling about the energy comparison you started. This call is recorded for quality and compliance. Is that okay?" },
      { id: "utt-1002-2", speaker: "customer", startMs: 5500, endMs: 6900, text: "Yes, that's fine." },
      { id: "utt-1002-3", speaker: "ai", startMs: 7200, endMs: 10100, text: "Thanks. I just need your estimated quarterly electricity usage." },
    ],
  },
  {
    id: "call-1003",
    journeyId: "journey-1003",
    status: "handoff",
    consentRecorded: true,
    safetyScore: 42,
    provider: "mock",
    currentQuestionKey: "concession",
    startedAt: "2026-09-18T05:40:00.000Z",
    handoff: {
      reason: "asked-for-human",
      summary: "Customer consented and confirmed move-in date. They asked to speak with a person before discussing concession eligibility.",
      collected: [{ label: "Move-in date", value: "22 Sep 2026" }],
      remaining: ["Concession card"],
    },
    utterances: [
      { id: "utt-1003-1", speaker: "ai", startMs: 0, endMs: 4800, text: "Hi Carol, this call is being recorded. Is it okay to continue?" },
      { id: "utt-1003-2", speaker: "customer", startMs: 5100, endMs: 6200, text: "Yes." },
      { id: "utt-1003-3", speaker: "ai", startMs: 6600, endMs: 9200, text: "What date are you moving in?" },
      { id: "utt-1003-4", speaker: "customer", startMs: 9500, endMs: 11400, text: "Twenty second of September." },
      { id: "utt-1003-5", speaker: "ai", startMs: 12100, endMs: 16000, text: "Thank you. Do you have a concession card we should include?" },
      { id: "utt-1003-6", speaker: "customer", startMs: 16300, endMs: 18300, text: "Can I speak with a person for that?" },
    ],
  },
]

const auditTranscript: Utterance[] = [
  { id: "audit-utt-1", speaker: "sales-agent", startMs: 0, endMs: 5200, text: "This call is recorded for quality, training and compliance purposes." },
  { id: "audit-utt-2", speaker: "customer", startMs: 5400, endMs: 6900, text: "Okay." },
  { id: "audit-utt-3", speaker: "sales-agent", startMs: 842000, endMs: 847000, text: "The peak electricity rate on this plan is twenty eight point six cents per kilowatt hour." },
  { id: "audit-utt-4", speaker: "customer", startMs: 850000, endMs: 854500, text: "And you have my email as alice at acme dot com?" },
  { id: "audit-utt-5", speaker: "sales-agent", startMs: 855000, endMs: 858500, text: "Yes, alice at acme dot com." },
]

export const demoAudits: AuditRun[] = [
  {
    id: "audit-9001",
    leadName: "Alice Johnson",
    agentName: "Mia Patel",
    retailer: "EnergyAustralia",
    status: "hold",
    confidence: 92,
    aiSummary: "Critical factual mismatch detected: the agent stated a peak rate lower than the retailer source of truth.",
    transcript: auditTranscript,
    checks: [
      {
        id: "check-recording-disclaimer",
        label: "Recording disclaimer was stated",
        type: "script",
        critical: true,
        verdict: "pass",
        confidence: 98,
        finding: "Agent clearly stated the recording disclaimer at the start of the call.",
        evidence: [{ utteranceId: "audit-utt-1", startMs: 0, endMs: 5200, quote: auditTranscript[0].text }],
      },
      {
        id: "check-peak-rate",
        label: "Peak electricity rate matches retailer product data",
        type: "factual",
        critical: true,
        verdict: "fail",
        confidence: 94,
        finding: "Agent stated 28.6c/kWh, but the source product table says 31.9c/kWh.",
        evidence: [{ utteranceId: "audit-utt-3", startMs: 842000, endMs: 847000, quote: auditTranscript[2].text, correctValue: "31.9c/kWh" }],
      },
      {
        id: "check-email-confirmation",
        label: "Customer email matches CRM",
        type: "factual",
        critical: true,
        verdict: "pass",
        confidence: 93,
        finding: "Verbal confirmation matches CRM email alice@acme.com.",
        evidence: [{ utteranceId: "audit-utt-4", startMs: 850000, endMs: 854500, quote: auditTranscript[3].text, correctValue: "alice@acme.com" }],
      },
      {
        id: "check-interruptions",
        label: "Conversation quality and interruptions",
        type: "behaviour",
        critical: false,
        verdict: "review",
        confidence: 71,
        finding: "No critical issue. Coaching note: agent answered quickly but did not pause after rate disclosure.",
        evidence: [{ utteranceId: "audit-utt-3", startMs: 842000, endMs: 847000, quote: auditTranscript[2].text }],
      },
    ],
  },
  {
    id: "audit-9002",
    leadName: "Bob Martinez",
    agentName: "Leo Chen",
    retailer: "AGL",
    status: "auto-pass",
    confidence: 96,
    aiSummary: "All critical retailer script and factual requirements passed.",
    transcript: [
      { id: "audit-utt-b1", speaker: "sales-agent", startMs: 0, endMs: 5100, text: "This call is recorded for quality, training and compliance." },
      { id: "audit-utt-b2", speaker: "sales-agent", startMs: 650000, endMs: 657000, text: "The peak electricity rate is thirty one point nine cents per kilowatt hour." },
    ],
    checks: [
      { id: "check-b-disclaimer", label: "Recording disclaimer was stated", type: "script", critical: true, verdict: "pass", confidence: 97, finding: "Disclaimer passed.", evidence: [{ utteranceId: "audit-utt-b1", startMs: 0, endMs: 5100, quote: "This call is recorded for quality, training and compliance." }] },
      { id: "check-b-rate", label: "Peak rate matches product data", type: "factual", critical: true, verdict: "pass", confidence: 95, finding: "Rate matched retailer product table.", evidence: [{ utteranceId: "audit-utt-b2", startMs: 650000, endMs: 657000, quote: "The peak electricity rate is thirty one point nine cents per kilowatt hour.", correctValue: "31.9c/kWh" }] },
    ],
  },
  {
    id: "audit-9003",
    leadName: "Carol Nguyen",
    agentName: "Ava Singh",
    retailer: "Origin",
    status: "human-review",
    confidence: 68,
    aiSummary: "Low confidence on mandatory concession disclosure due to overlapping speech. Human QA required.",
    transcript: [
      { id: "audit-utt-c1", speaker: "sales-agent", startMs: 0, endMs: 5200, text: "This call is recorded for quality and compliance." },
      { id: "audit-utt-c2", speaker: "customer", startMs: 910000, endMs: 914000, text: "Sorry, you both spoke at once there." },
    ],
    checks: [
      { id: "check-c-disclaimer", label: "Recording disclaimer was stated", type: "script", critical: true, verdict: "pass", confidence: 96, finding: "Disclaimer passed.", evidence: [{ utteranceId: "audit-utt-c1", startMs: 0, endMs: 5200, quote: "This call is recorded for quality and compliance." }] },
      { id: "check-c-concession", label: "Mandatory concession disclosure", type: "script", critical: true, verdict: "review", confidence: 58, finding: "Possible disclosure, but overlapping speech makes the result uncertain.", evidence: [{ utteranceId: "audit-utt-c2", startMs: 910000, endMs: 914000, quote: "Sorry, you both spoke at once there." }] },
    ],
  },
]

export function formatMs(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
