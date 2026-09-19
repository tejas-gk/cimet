/**
 * Professional lead-recovery + sales voice agent.
 *
 * PRINCIPLES
 * ----------
 * 1. Never ask for information that already exists.
 * 2. The customer should never feel like the AI is reading a form.
 * 3. Missing fields are collected naturally during the conversation.
 * 4. Sales and data collection happen together.
 * 5. Application code controls journey state.
 * 6. The LLM controls language, transitions, objections and extraction.
 * 7. Every useful piece of information the customer volunteers is captured.
 * 8. Existing confirmed data is not overwritten unless the customer corrects it.
 */

import {
  chatJson,
  speechToText,
  textToSpeech,
  SARVAM_MODELS,
} from "@/lib/server/sarvam"

import type { ChatMessage } from "@/lib/server/sarvam"
import type { HandoffReason } from "@/lib/cimet-ai-types"

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type SolarSpeaker =
  | "user"
  | "ai"
  | "human-agent"

export type SolarConversationLine = {
  speaker: SolarSpeaker
  text: string
}

export type SolarHandoff = {
  reason: HandoffReason
  summary: string
  collected?: Array<{
    label: string
    value: string
  }>
}

export type SolarTurn = {
  speaker: "ai" | "human-agent"
  text: string
  audioBase64: string | null
}

export type LeadFormField =
  | "name"
  | "email"
  | "phone"
  | "company"
  | "state"
  | "retailer"
  | "plan"
  | "usage"
  | "address"
  | "postcode"
  | "dob"
  | "fuelType"
  | "nmiMirn"
  | "concession"
  | "lifeSupport"
  | "moveInDate"

export type LeadContext =
  Partial<Record<LeadFormField, string>>

export type ExtractedLeadData =
  Partial<Record<LeadFormField, string>>

export type SolarTurnResult = {
  transcript: string

  turns: SolarTurn[]

  handoff: SolarHandoff | null

  needsHumanAgent: boolean

  /**
   * Full known state after this turn.
   */
  extractedData?: ExtractedLeadData

  /**
   * Only fields collected/corrected this turn.
   * Prefer sending this to merge-data.
   */
  newlyExtractedData?: ExtractedLeadData

  currentField?: LeadFormField | null

  nextMissingField?: LeadFormField | null

  missingFields?: LeadFormField[]

  journeyComplete?: boolean

  optedOut?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Field configuration
// ─────────────────────────────────────────────────────────────────────────────

const ALL_LEAD_FIELDS: LeadFormField[] = [
  "name",
  "email",
  "phone",
  "company",
  "state",
  "retailer",
  "plan",
  "usage",
  "address",
  "postcode",
  "dob",
  "fuelType",
  "nmiMirn",
  "concession",
  "lifeSupport",
  "moveInDate",
]

/**
 * IMPORTANT:
 *
 * Change this to exactly match the fields required by your
 * Energy recovery journey.
 *
 * The order is the preferred collection order.
 *
 * Existing values are automatically skipped.
 */
export const REQUIRED_JOURNEY_FIELDS: LeadFormField[] = [
  "name",
  "email",
  "phone",
  "address",
  "postcode",
  "state",
  "fuelType",
  "retailer",
  "usage",
  "concession",
  "lifeSupport",
  "moveInDate",
  "nmiMirn",
]

export const OPTIONAL_JOURNEY_FIELDS: LeadFormField[] = [
  "company",
  "plan",
  "dob",
]

const LEAD_FIELD_SET =
  new Set<string>(ALL_LEAD_FIELDS)

const FIELD_LABELS: Record<
  LeadFormField,
  string
> = {
  name: "customer name",

  email: "email address",

  phone: "phone number",

  company: "company or organisation",

  state: "state",

  retailer: "current energy retailer",

  plan: "current energy plan",

  usage: "energy usage or typical bill",

  address: "property/service address",

  postcode: "property postcode",

  dob: "date of birth",

  fuelType:
    "whether the property requires electricity, gas, or both",

  nmiMirn: "NMI or MIRN",

  concession: "concession eligibility/status",

  lifeSupport:
    "registered life-support status",

  moveInDate: "move-in date",
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FORCE_HANDOFF_TEXT =
  "__ESCALATE__"

const AI_VOICE = "ishita"
const HUMAN_VOICE = "aditya"

// ─────────────────────────────────────────────────────────────────────────────
// Data helpers
// ─────────────────────────────────────────────────────────────────────────────

function hasValue(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  )
}

function cleanLeadContext(
  context: LeadContext
): LeadContext {
  const result: LeadContext = {}

  for (const field of ALL_LEAD_FIELDS) {
    const value = context[field]

    if (hasValue(value)) {
      result[field] = value.trim()
    }
  }

  return result
}

export function getMissingFields(
  context: LeadContext
): LeadFormField[] {
  return REQUIRED_JOURNEY_FIELDS.filter(
    (field) => !hasValue(context[field])
  )
}

export function getNextMissingField(
  context: LeadContext
): LeadFormField | null {
  return (
    getMissingFields(context)[0] ??
    null
  )
}

/**
 * Existing values win by default.
 *
 * A new value only replaces an existing value when
 * allowCorrections[field] === true.
 */
function mergeLeadData(
  existing: LeadContext,
  extracted: ExtractedLeadData,
  correctedFields: LeadFormField[] = []
): LeadContext {
  const result =
    cleanLeadContext(existing)

  const correctionSet =
    new Set(correctedFields)

  for (const [rawField, rawValue] of Object.entries(
    extracted
  )) {
    if (!LEAD_FIELD_SET.has(rawField)) {
      continue
    }

    if (!hasValue(rawValue)) {
      continue
    }

    const field =
      rawField as LeadFormField

    const existingValue =
      result[field]

    /**
     * Never silently overwrite known data.
     */
    if (
      hasValue(existingValue) &&
      !correctionSet.has(field)
    ) {
      continue
    }

    result[field] =
      rawValue.trim()
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Greeting
// ─────────────────────────────────────────────────────────────────────────────

export function buildGreeting(
  leadContext: LeadContext = {}
): string {
  const lead =
    cleanLeadContext(leadContext)

  if (lead.name) {
    return `Hi ${lead.name}, this is Priya calling regarding the energy comparison you started with us earlier. I wanted to pick up from where you left off and see if we can help you find a suitable option. Is now a good time for a quick chat?`
  }

  return "Hi, this is Priya calling regarding the energy comparison you started with us earlier. I wanted to pick up from where you left off and see if we can help you find a suitable option. Is now a good time for a quick chat?"
}

/**
 * Compatibility export for old /api/solar/start.
 *
 * Prefer synthesizeGreeting(leadContext) for real calls,
 * because it can use the customer's name.
 */
export const SOLAR_GREETING =
  "Hi, this is Priya calling regarding the energy comparison you started with us earlier. I wanted to pick up from where you left off and see if we can help you find a suitable option. Is now a good time for a quick chat?"

// ─────────────────────────────────────────────────────────────────────────────
// Conversation strategy
// ─────────────────────────────────────────────────────────────────────────────

function getConversationHint(
  field: LeadFormField | null
): string {
  if (!field) {
    return [
      "All required recovery information has been collected.",
      "Do not ask unnecessary form questions.",
      "Continue the sales conversation naturally.",
      "Understand the customer's interest and help move the enquiry forward.",
    ].join(" ")
  }

  switch (field) {
    case "name":
      return [
        "The customer's name is missing.",
        "Obtain it naturally when appropriate, for example while confirming who you are speaking with.",
        "Do not abruptly say 'What is your name?' unless necessary.",
      ].join(" ")

    case "email":
      return [
        "The email address is missing.",
        "Ask for it naturally in the context of sending or continuing the comparison.",
      ].join(" ")

    case "phone":
      return [
        "The phone number is missing.",
        "Only confirm or request the best contact number when it naturally makes sense.",
      ].join(" ")

    case "address":
      return [
        "The service/property address is missing.",
        "Transition naturally by explaining that available energy options depend on the property/location.",
        "Then ask where the service is required.",
      ].join(" ")

    case "postcode":
      return [
        "The postcode is missing.",
        "Explain briefly that availability varies by area and naturally confirm the property's postcode.",
      ].join(" ")

    case "state":
      return [
        "The state is missing.",
        "Confirm the property's state naturally as part of checking available options.",
      ].join(" ")

    case "fuelType":
      return [
        "The required energy type is missing.",
        "Naturally establish whether the customer is looking at electricity, gas, or both.",
      ].join(" ")

    case "retailer":
      return [
        "The current retailer is missing.",
        "Naturally ask who currently supplies their energy so you can understand what they are comparing against.",
      ].join(" ")

    case "usage":
      return [
        "Usage/bill information is missing.",
        "Ask naturally about their typical energy bill or usage because it helps understand which options may be relevant.",
      ].join(" ")

    case "concession":
      return [
        "Concession information is missing.",
        "Ask professionally whether they currently hold an eligible concession card because this can affect the comparison.",
      ].join(" ")

    case "lifeSupport":
      return [
        "Life-support status is missing.",
        "Ask this carefully and professionally as a required service detail.",
        "Do not make sales claims around this information.",
      ].join(" ")

    case "moveInDate":
      return [
        "Move-in information is missing.",
        "If relevant, naturally establish whether this is for the current property or a move, and when supply is needed.",
      ].join(" ")

    case "nmiMirn":
      return [
        "The NMI/MIRN is missing.",
        "Ask whether the customer has it available only when appropriate.",
        "Never invent or guess it.",
      ].join(" ")

    case "company":
      return [
        "Company information is missing.",
        "Only ask naturally if this appears to be a business enquiry.",
      ].join(" ")

    case "plan":
      return [
        "Current plan information is missing.",
        "Naturally ask whether they know which plan they are currently on.",
      ].join(" ")

    case "dob":
      return [
        "Date of birth is missing.",
        "Only request it when it is genuinely required for the journey and explain briefly why it is needed.",
      ].join(" ")
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main LLM prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildRecoverySystemPrompt(
  leadContext: LeadContext
): string {
  const lead =
    cleanLeadContext(leadContext)

  const missingFields =
    getMissingFields(lead)

  const targetField =
    missingFields[0] ?? null

  const knownText =
    Object.entries(lead)
      .map(
        ([field, value]) =>
          `- ${FIELD_LABELS[field as LeadFormField]}: ${value}`
      )
      .join("\n") ||
    "(no confirmed information)"

  const missingText =
    missingFields
      .map(
        (field) =>
          `- ${field}: ${FIELD_LABELS[field]}`
      )
      .join("\n") ||
    "(all required fields collected)"

  const targetText =
    targetField
      ? `${targetField}: ${FIELD_LABELS[targetField]}`
      : "NONE"

  return [
    "ROLE",
    "You are Priya, a professional Energy sales and customer-recovery specialist.",
    "The customer previously started an Energy comparison/enquiry but did not finish it.",
    "You are calling to continue their existing journey, understand their needs, help them progress, and professionally develop the sales opportunity.",
    "",
    "MOST IMPORTANT BEHAVIOUR",
    "This must sound like a genuine professional sales conversation, NOT like someone reading fields from a form.",
    "The customer should not feel interrogated.",
    "Build rapport, acknowledge what they say, explain relevance where useful, answer their questions, and naturally transition into the next useful question.",
    "",
    "EXISTING INFORMATION",
    knownText,
    "",
    "ABSOLUTE RULE ABOUT EXISTING DATA",
    "NEVER ask for a piece of information that already exists above.",
    "Treat existing information as confirmed.",
    "You may naturally use existing information in conversation.",
    "For example, if the customer's name is known, use their name.",
    "If their postcode is known, do not ask for their postcode again.",
    "If their retailer is known, you may say 'I can see you're currently with X' instead of asking who their retailer is.",
    "Only replace existing information when the customer explicitly corrects it.",
    "",
    "INFORMATION STILL MISSING",
    missingText,
    "",
    "CURRENT CONVERSATIONAL TARGET",
    targetText,
    "",
    "STRATEGY FOR THIS TARGET",
    getConversationHint(targetField),
    "",
    "JOURNEY CONTROL",
    "The application has selected CURRENT CONVERSATIONAL TARGET.",
    "Use it to guide the conversation.",
    "Do not randomly jump through the entire list of missing fields.",
    "Normally ask only ONE primary question at a time.",
    "However, you do NOT need to mechanically ask the exact field label.",
    "Use professional conversational transitions.",
    "",
    "BAD EXAMPLE:",
    "'What is your postcode?'",
    "",
    "BETTER EXAMPLE:",
    "'To make sure we're looking at options available for your property, could I just confirm the postcode there?'",
    "",
    "BAD EXAMPLE:",
    "'Who is your retailer?'",
    "",
    "BETTER EXAMPLE:",
    "'Just so I understand what we're comparing against, who are you currently with for your electricity?'",
    "",
    "BAD EXAMPLE:",
    "'What is your usage?'",
    "",
    "BETTER EXAMPLE:",
    "'And roughly what does a typical electricity bill look like for you? That gives me a better idea of the kind of option that may actually make sense.'",
    "",
    "SALES + DATA COLLECTION",
    "Do NOT treat form completion and selling as separate phases.",
    "Do both throughout the conversation.",
    "When appropriate, briefly explain WHY a detail matters.",
    "Use information the customer provides to make the conversation more relevant.",
    "If the customer shows interest, develop it professionally.",
    "If the customer asks about the product, service, pricing, savings, process, or available options, answer naturally and then transition back into the journey.",
    "If they raise an objection, acknowledge it, address it concisely, and continue naturally if they remain engaged.",
    "",
    "DO NOT make unsupported guarantees, invent prices, invent eligibility, invent savings, or fabricate offers.",
    "Do not give financial advice.",
    "",
    "CUSTOMER RESPONSES",
    "A short answer like 'yes', 'no', 'around 600', or 'next month' must be interpreted in the context of the question you just asked.",
    "",
    "For example:",
    "If you asked about concession status and the customer says 'no', extract concession='no' and continue.",
    "If you asked about life support and the customer says 'no', extract lifeSupport='no' and continue.",
    "If you asked about electricity and gas and they say 'both', extract fuelType='both'.",
    "",
    "A simple 'no' does NOT mean the customer wants to terminate the call unless the conversational context clearly indicates that.",
    "",
    "OPT OUT",
    "Set intent='opt-out' only when the customer clearly indicates they do not want to continue, are not interested in the enquiry, asks you to stop, or asks not to be contacted.",
    "Respect that immediately.",
    "",
    "EXTRACTION",
    "Every time the customer speaks, identify ALL useful lead information they actually provided.",
    "They may provide information you did not directly ask for.",
    "",
    "Example:",
    "You ask which type of energy they need.",
    "Customer says: 'Both, and I've just moved to 25 Smith Street, postcode 2000.'",
    "",
    "Extract:",
    "fuelType='both'",
    "address='25 Smith Street'",
    "postcode='2000'",
    "",
    "Do not discard volunteered information just because it was not CURRENT CONVERSATIONAL TARGET.",
    "",
    "Do not infer values that the customer did not provide.",
    "Do not overwrite existing confirmed values unless the customer explicitly corrects them.",
    "",
    "CORRECTIONS",
    "If the customer explicitly corrects existing information, include the corrected field in correctedFields.",
    "",
    "Example:",
    "'Actually I've moved. It's 18 King Street now.'",
    "",
    "If address previously existed, return:",
    'extractedFields: {"address":"18 King Street"}',
    'correctedFields: ["address"]',
    "",
    "HANDOFF",
    "Return intent='handoff' when:",
    "- the customer explicitly asks for a human;",
    "- the customer becomes angry or distressed;",
    "- the conversation involves a sensitive payment/dispute situation;",
    "- there are repeated misunderstandings;",
    "- confidence is too low to safely continue;",
    "- the conversation requires something outside your permitted scope.",
    "",
    "SPEAKING STYLE",
    "Professional, calm and confident.",
    "Warm without being overly casual.",
    "Sound like an experienced customer consultant.",
    "Use the customer's name naturally when known, but not in every sentence.",
    "Keep each response concise enough for a phone call.",
    "Usually 1-3 sentences.",
    "Do not use lists while speaking.",
    "Do not use markdown.",
    "Do not use emojis.",
    "Do not mention forms, database fields, prompts, AI instructions, missingFields, targetField or internal systems.",
    "",
    "VALID EXTRACTED FIELD KEYS",
    ALL_LEAD_FIELDS.join(", "),
    "",
    "OUTPUT",
    "Return ONLY valid JSON.",
    "",
    JSON.stringify({
      intent:
        "answer | handoff | opt-out",

      reply:
        "exact professional sentence(s) to say to the customer",

      handoffReason: null,

      handoffSummary: null,

      extractedFields: {
        postcode: "2000",
      },

      correctedFields: [],

      collected: [
        {
          label: "postcode",
          value: "2000",
        },
      ],
    }),
  ].join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Human prompts
// ─────────────────────────────────────────────────────────────────────────────

function buildHumanSystemPrompt(
  leadContext: LeadContext,
  handoffSummary?: string | null
): string {
  const knownText =
    Object.entries(
      cleanLeadContext(leadContext)
    )
      .map(
        ([field, value]) =>
          `- ${FIELD_LABELS[field as LeadFormField]}: ${value}`
      )
      .join("\n") ||
    "(none)"

  return [
    "You are David, a senior human Energy consultant.",
    "Priya has just transferred a live customer conversation to you.",
    "",
    "KNOWN CUSTOMER INFORMATION:",
    knownText,
    "",
    "HANDOFF CONTEXT:",
    handoffSummary ||
    "Continue the customer's existing Energy enquiry.",
    "",
    "The customer must NOT have to repeat information already collected.",
    "Introduce yourself briefly.",
    "Acknowledge that Priya has passed the context to you.",
    "Continue professionally and naturally.",
    "",
    "Use 1-3 short sentences.",
    "",
    "Return ONLY JSON:",
    '{"reply":"exact words to say"}',
  ].join("\n")
}

function buildHumanContinuePrompt(
  leadContext: LeadContext
): string {
  const knownText =
    Object.entries(
      cleanLeadContext(leadContext)
    )
      .map(
        ([field, value]) =>
          `- ${FIELD_LABELS[field as LeadFormField]}: ${value}`
      )
      .join("\n") ||
    "(none)"

  return [
    "You are David, a senior human Energy consultant.",
    "You are already speaking with this customer after taking over from Priya.",
    "",
    "KNOWN INFORMATION:",
    knownText,
    "",
    "Continue professionally.",
    "Do not ask them to repeat known information.",
    "Use 1-3 short sentences.",
    "",
    "Return ONLY JSON:",
    '{"reply":"exact words to say"}',
  ].join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Message conversion
// ─────────────────────────────────────────────────────────────────────────────

function toMessages(
  prompt: string,
  history: SolarConversationLine[],
  latest: string
): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: prompt,
    },
  ]

  for (const line of history.slice(-30)) {
    messages.push({
      role:
        line.speaker === "user"
          ? "user"
          : "assistant",

      content: line.text,
    })
  }

  if (latest) {
    messages.push({
      role: "user",
      content: latest,
    })
  }

  return messages
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision types
// ─────────────────────────────────────────────────────────────────────────────

type RawSalesDecision = {
  intent?:
  | "answer"
  | "handoff"
  | "opt-out"

  reply?: unknown

  handoffReason?: unknown

  handoffSummary?: unknown

  extractedFields?: unknown

  correctedFields?: unknown

  collected?: unknown
}

type NormalizedDecision = {
  intent:
  | "answer"
  | "handoff"
  | "opt-out"

  reply: string

  handoffReason:
  | HandoffReason
  | null

  handoffSummary:
  | string
  | null

  extractedFields:
  ExtractedLeadData

  correctedFields:
  LeadFormField[]

  collected: Array<{
    label: string
    value: string
  }>
}

const VALID_HANDOFF_REASONS =
  new Set<string>([
    "asked-for-human",
    "angry-customer",
    "low-confidence",
    "out-of-scope",
    "sensitive-topic",
    "repeated-misunderstanding",
  ])

function normalizeDecision(
  raw: RawSalesDecision
): NormalizedDecision {
  let intent:
    NormalizedDecision["intent"] =
    "answer"

  if (raw.intent === "handoff") {
    intent = "handoff"
  }

  if (raw.intent === "opt-out") {
    intent = "opt-out"
  }

  const reply =
    typeof raw.reply === "string"
      ? raw.reply.trim()
      : ""

  let handoffReason:
    HandoffReason | null =
    null

  if (
    typeof raw.handoffReason ===
    "string" &&
    VALID_HANDOFF_REASONS.has(
      raw.handoffReason
    )
  ) {
    handoffReason =
      raw.handoffReason as HandoffReason
  }

  const handoffSummary =
    typeof raw.handoffSummary ===
      "string"
      ? raw.handoffSummary.trim()
      : null

  const extractedFields:
    ExtractedLeadData = {}

  if (
    raw.extractedFields &&
    typeof raw.extractedFields ===
    "object" &&
    !Array.isArray(
      raw.extractedFields
    )
  ) {
    for (const [key, value] of Object.entries(
      raw.extractedFields as Record<
        string,
        unknown
      >
    )) {
      if (
        !LEAD_FIELD_SET.has(key)
      ) {
        continue
      }

      if (!hasValue(value)) {
        continue
      }

      extractedFields[
        key as LeadFormField
      ] = value.trim()
    }
  }

  const correctedFields:
    LeadFormField[] = []

  if (
    Array.isArray(
      raw.correctedFields
    )
  ) {
    for (const field of raw.correctedFields) {
      if (
        typeof field === "string" &&
        LEAD_FIELD_SET.has(field)
      ) {
        correctedFields.push(
          field as LeadFormField
        )
      }
    }
  }

  const collected: Array<{
    label: string
    value: string
  }> = []

  if (Array.isArray(raw.collected)) {
    for (const item of raw.collected) {
      if (
        !item ||
        typeof item !== "object"
      ) {
        continue
      }

      const candidate =
        item as {
          label?: unknown
          value?: unknown
        }

      if (
        typeof candidate.label ===
        "string" &&
        typeof candidate.value ===
        "string" &&
        candidate.label.trim() &&
        candidate.value.trim()
      ) {
        collected.push({
          label:
            candidate.label.trim(),

          value:
            candidate.value.trim(),
        })
      }
    }
  }

  return {
    intent,
    reply,
    handoffReason,
    handoffSummary,
    extractedFields,
    correctedFields,
    collected,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS
// ─────────────────────────────────────────────────────────────────────────────

async function synthesize(
  text: string,
  agent:
    | "ai"
    | "human-agent"
): Promise<string | null> {
  try {
    const tts =
      await textToSpeech({
        text,

        speaker:
          agent ===
            "human-agent"
            ? HUMAN_VOICE
            : AI_VOICE,

        sampleRate: 16000,

        codec: "wav",
      })

    return tts.audio.toString(
      "base64"
    )
  } catch (error) {
    console.warn(
      "[lead-recovery] TTS failed:",
      error instanceof Error
        ? error.message
        : error
    )

    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Greeting API
// ─────────────────────────────────────────────────────────────────────────────

export async function synthesizeGreeting(
  leadContext: LeadContext = {}
): Promise<string | null> {
  return synthesize(
    buildGreeting(leadContext),
    "ai"
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Collected-field fallback mapping
// ─────────────────────────────────────────────────────────────────────────────

function mapCollectedFields(
  collected: Array<{
    label: string
    value: string
  }>
): ExtractedLeadData {
  const result:
    ExtractedLeadData = {}

  const mapping:
    Record<
      string,
      LeadFormField
    > = {
    name: "name",
    fullname: "name",

    email: "email",
    emailaddress: "email",

    phone: "phone",
    phonenumber: "phone",

    company: "company",
    organisation: "company",
    organization: "company",

    state: "state",

    retailer: "retailer",
    currentretailer: "retailer",
    energyretailer: "retailer",

    plan: "plan",
    energyplan: "plan",

    usage: "usage",
    energyusage: "usage",
    monthlybill: "usage",
    electricitybill: "usage",

    address: "address",
    serviceaddress: "address",
    propertyaddress: "address",

    postcode: "postcode",
    postalcode: "postcode",
    zipcode: "postcode",
    zip: "postcode",

    dob: "dob",
    dateofbirth: "dob",

    fueltype: "fuelType",
    energytype: "fuelType",

    nmi: "nmiMirn",
    mirn: "nmiMirn",
    nmimirn: "nmiMirn",

    concession: "concession",
    concessioncard: "concession",

    lifesupport: "lifeSupport",
    lifesupportequipment:
      "lifeSupport",

    moveindate: "moveInDate",
  }

  for (const item of collected) {
    const normalized =
      item.label
        .toLowerCase()
        .replace(
          /[^a-z0-9]/g,
          ""
        )

    const field =
      mapping[normalized]

    if (
      field &&
      hasValue(item.value)
    ) {
      result[field] =
        item.value.trim()
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction merge
// ─────────────────────────────────────────────────────────────────────────────

function buildExtractedData(
  customerText: string,
  decision: NormalizedDecision,
  existingLead: LeadContext
): {
  newlyExtracted:
  ExtractedLeadData

  fullLead:
  LeadContext
} {
  const newlyExtracted:
    ExtractedLeadData = {
    ...mapCollectedFields(
      decision.collected
    ),

    ...decision.extractedFields,
  }

  /**
   * Lightweight deterministic name fallback.
   */
  if (
    !existingLead.name &&
    !newlyExtracted.name
  ) {
    const nameMatch =
      customerText.match(
        /(?:my name is|i'm|i am|im)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)/i
      )

    if (nameMatch?.[1]) {
      newlyExtracted.name =
        nameMatch[1].trim()
    }
  }

  /**
   * Remove attempted overwrites unless
   * explicitly marked as corrections.
   */
  for (const field of ALL_LEAD_FIELDS) {
    const oldValue =
      existingLead[field]

    const newValue =
      newlyExtracted[field]

    if (
      hasValue(oldValue) &&
      hasValue(newValue) &&
      !decision.correctedFields.includes(
        field
      )
    ) {
      delete newlyExtracted[field]
    }
  }

  const fullLead =
    mergeLeadData(
      existingLead,
      newlyExtracted,
      decision.correctedFields
    )

  return {
    newlyExtracted,
    fullLead,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fallback
// ─────────────────────────────────────────────────────────────────────────────

function fallbackResponse(
  field: LeadFormField | null
): string {
  switch (field) {
    case "name":
      return "Before we go further, could I just confirm who I'm speaking with?"

    case "email":
      return "I can continue this for you and make sure the details are sent to the right place. What's the best email address to use?"

    case "phone":
      return "And just so we have the right contact details, what's the best number to keep against the enquiry?"

    case "address":
      return "To make sure we're looking at the right options for the property, could you tell me the service address?"

    case "postcode":
      return "Availability can vary by area, so could I just confirm the postcode for the property?"

    case "state":
      return "Just so I'm checking the right market, which state is the property in?"

    case "fuelType":
      return "And for the property itself, are you looking to compare electricity, gas, or both?"

    case "retailer":
      return "Just so I understand what we're comparing against, who are you currently with for your energy?"

    case "usage":
      return "To get a better sense of what may suit you, roughly what does a typical energy bill look like?"

    case "concession":
      return "There are a couple of eligibility details that can affect the comparison. Do you currently hold a concession card?"

    case "lifeSupport":
      return "I also need to confirm one important service detail: is there any registered life-support equipment at the property?"

    case "moveInDate":
      return "And is this for your current property or an upcoming move? If you're moving, when do you need the supply active?"

    case "nmiMirn":
      return "If you have a recent bill nearby, do you happen to have the NMI or MIRN available?"

    case "company":
      return "And is the enquiry for you personally or for a business?"

    case "plan":
      return "Do you happen to know which energy plan you're currently on?"

    case "dob":
      return "To complete the remaining account details, could I confirm your date of birth?"

    default:
      return "Thanks, that gives me what I need there. Let me take you through what we can do from here."
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processSolarTurn(
  params: {
    text?: string

    audioBase64?: string

    history:
    SolarConversationLine[]

    humanAgent: boolean

    /**
     * IMPORTANT:
     *
     * This MUST contain the latest persisted
     * lead data on every turn.
     */
    leadContext?: LeadContext
  }
): Promise<SolarTurnResult> {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Resolve customer input
  // ───────────────────────────────────────────────────────────────────────────

  let customerText =
    params.text?.trim() ?? ""

  if (params.audioBase64) {
    const audio =
      Buffer.from(
        params.audioBase64,
        "base64"
      )

    if (!audio.length) {
      throw new Error(
        "Empty audio received"
      )
    }

    const stt =
      await speechToText({
        audio,

        filename:
          "lead-recovery-turn.wav",
      })

    customerText =
      stt.transcript.trim()
  }

  if (!customerText) {
    throw new Error(
      "No speech or text detected in this turn"
    )
  }

  const forcedEscalation =
    customerText ===
    FORCE_HANDOFF_TEXT

  const displayText =
    forcedEscalation
      ? "I'd like to speak with a human, please."
      : customerText

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Current journey state
  // ───────────────────────────────────────────────────────────────────────────

  const existingLead =
    cleanLeadContext(
      params.leadContext ?? {}
    )

  const missingBefore =
    getMissingFields(
      existingLead
    )

  const currentField =
    missingBefore[0] ?? null

  console.log(
    "[lead-recovery] BEFORE",
    {
      existingLead,
      missingBefore,
      currentField,
    }
  )

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Human already owns conversation
  // ───────────────────────────────────────────────────────────────────────────

  if (params.humanAgent) {
    const humanDecision =
      await chatJson<{
        reply?: string
      }>({
        model:
          SARVAM_MODELS.voice,

        maxTokens: 500,

        messages: toMessages(
          buildHumanContinuePrompt(
            existingLead
          ),

          params.history,

          displayText
        ),
      })

    const humanText =
      humanDecision.reply?.trim() ||
      "Thanks. I have the details already collected here, so you won't need to go over them again. Let me help you from here."

    const audio =
      await synthesize(
        humanText,
        "human-agent"
      )

    return {
      transcript:
        displayText,

      turns: [
        {
          speaker:
            "human-agent",

          text:
            humanText,

          audioBase64:
            audio,
        },
      ],

      handoff: null,

      needsHumanAgent: true,

      extractedData:
        existingLead,

      newlyExtractedData:
        {},

      currentField,

      nextMissingField:
        currentField,

      missingFields:
        missingBefore,

      journeyComplete:
        missingBefore.length ===
        0,

      optedOut: false,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. AI decision
  // ───────────────────────────────────────────────────────────────────────────

  const rawDecision =
    await chatJson<RawSalesDecision>({
      model:
        SARVAM_MODELS.voice,

      maxTokens: 1000,

      messages: toMessages(
        buildRecoverySystemPrompt(
          existingLead
        ),

        params.history,

        displayText
      ),
    })

  console.log(
    "[lead-recovery] RAW LLM",
    JSON.stringify(
      rawDecision,
      null,
      2
    )
  )

  const decision =
    normalizeDecision(
      rawDecision
    )

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Extract + merge data
  // ───────────────────────────────────────────────────────────────────────────

  const {
    newlyExtracted,
    fullLead,
  } = buildExtractedData(
    customerText,
    decision,
    existingLead
  )

  const missingAfter =
    getMissingFields(
      fullLead
    )

  const nextMissingField =
    missingAfter[0] ?? null

  const journeyComplete =
    missingAfter.length === 0

  console.log(
    "[lead-recovery] AFTER",
    {
      newlyExtracted,
      fullLead,
      missingAfter,
      nextMissingField,
      journeyComplete,
    }
  )

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Explicit opt-out
  // ───────────────────────────────────────────────────────────────────────────

  if (
    decision.intent ===
    "opt-out"
  ) {
    const text =
      decision.reply ||
      "Of course. Thanks for your time today, and I'll leave it there."

    const audio =
      await synthesize(
        text,
        "ai"
      )

    return {
      transcript:
        displayText,

      turns: [
        {
          speaker: "ai",
          text,
          audioBase64:
            audio,
        },
      ],

      handoff: null,

      needsHumanAgent: false,

      extractedData:
        fullLead,

      newlyExtractedData:
        newlyExtracted,

      currentField,

      nextMissingField,

      missingFields:
        missingAfter,

      journeyComplete,

      optedOut: true,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Human handoff
  // ───────────────────────────────────────────────────────────────────────────

  const shouldHandoff =
    forcedEscalation ||
    decision.intent ===
    "handoff"

  if (shouldHandoff) {
    const reason:
      HandoffReason =
      forcedEscalation
        ? "asked-for-human"
        : decision.handoffReason ??
        "asked-for-human"

    const aiText =
      decision.reply ||
      "Certainly. I'll bring one of our consultants into the conversation and pass across what we've already covered, so you won't need to repeat yourself."

    const summary =
      decision.handoffSummary ||
      `Customer requires human assistance. Information collected has been retained. ${nextMissingField
        ? `Next journey item is ${FIELD_LABELS[nextMissingField]}.`
        : "Required journey information is complete."
      }`

    const humanDecision =
      await chatJson<{
        reply?: string
      }>({
        model:
          SARVAM_MODELS.voice,

        maxTokens: 500,

        messages: toMessages(
          buildHumanSystemPrompt(
            fullLead,
            summary
          ),

          [
            ...params.history,

            {
              speaker:
                "user",

              text:
                displayText,
            },

            {
              speaker:
                "ai",

              text:
                aiText,
            },
          ],

          ""
        ),
      })

    const humanText =
      humanDecision.reply?.trim() ||
      "Hi, this is David. Priya has brought me up to speed on what you've discussed, and I have the details you've already provided. I'll take it from here."

    const [
      aiAudio,
      humanAudio,
    ] = await Promise.all([
      synthesize(
        aiText,
        "ai"
      ),

      synthesize(
        humanText,
        "human-agent"
      ),
    ])

    return {
      transcript:
        displayText,

      turns: [
        {
          speaker: "ai",
          text: aiText,
          audioBase64:
            aiAudio,
        },

        {
          speaker:
            "human-agent",

          text:
            humanText,

          audioBase64:
            humanAudio,
        },
      ],

      handoff: {
        reason,
        summary,

        collected:
          decision.collected,
      },

      needsHumanAgent: true,

      extractedData:
        fullLead,

      newlyExtractedData:
        newlyExtracted,

      currentField,

      nextMissingField,

      missingFields:
        missingAfter,

      journeyComplete,

      optedOut: false,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Normal professional response
  // ───────────────────────────────────────────────────────────────────────────

  const responseText =
    decision.reply ||
    fallbackResponse(
      nextMissingField
    )

  const audio =
    await synthesize(
      responseText,
      "ai"
    )

  return {
    transcript:
      displayText,

    turns: [
      {
        speaker: "ai",

        text:
          responseText,

        audioBase64:
          audio,
      },
    ],

    handoff: null,

    needsHumanAgent: false,

    extractedData:
      fullLead,

    newlyExtractedData:
      newlyExtracted,

    currentField,

    nextMissingField,

    missingFields:
      missingAfter,

    journeyComplete,

    optedOut: false,
  }
}