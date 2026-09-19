export type ProviderMode = "mock" | "external"

export type VoiceProviderId =
  "mock" | "sarvam" | "vapi" | "twilio-realtime" | "livekit"
export type TranscriptionProviderId =
  "mock" | "deepgram" | "assemblyai" | "whisper-local"
export type LlmProviderId = "mock" | "openai" | "gemini" | "ollama"

export type EnergyJourneyStatus =
  "dropped" | "calling" | "handoff" | "completed" | "declined"

export type EnergyJourneyField = {
  key: string
  label: string
  value: string | null
  required: boolean
  collectedBy?: "customer" | "ai" | "agent"
}

export type EnergyJourney = {
  id: string
  customerName: string
  phone: string
  email: string
  retailer: string
  state: string
  status: EnergyJourneyStatus
  abandonStep: string
  doNotCall: boolean
  fields: EnergyJourneyField[]
}

export type CallStatus =
  | "queued"
  | "ringing"
  | "consent"
  | "collecting"
  | "handoff"
  | "callback"
  | "completed"
  | "declined"

export type Speaker = "ai" | "customer" | "human-agent" | "sales-agent"

export type Utterance = {
  id: string
  speaker: Speaker
  text: string
  startMs: number
  endMs: number
}

export type HandoffReason =
  | "asked-for-human"
  | "angry-customer"
  | "low-confidence"
  | "out-of-scope"
  | "sensitive-topic"
  | "repeated-misunderstanding"

export type HandoffSeverity = "normal" | "sensitive" | "life-support"
export type HandoffStatus =
  | "assigned"
  | "accepted"
  | "waiting"
  | "callback"
  | "completed"

export type HandoffContext = {
  reason: HandoffReason
  summary: string
  collected: Array<{ label: string; value: string }>
  remaining: string[]
  status: HandoffStatus
  severity: HandoffSeverity
  assignedAgentId?: string
  assignedAgent?: string
  queuePosition?: number
  etaMinutes?: number
  callbackAt?: string
  createdAt?: string
  acceptedAt?: string
}

export type HumanAgentStatus = "online" | "away" | "busy"

export type HumanAgent = {
  id: string
  name: string
  role: string
  status: HumanAgentStatus
  maxConcurrent: number
  activeHandoffs: number
}

export type HandoffQueueItem = {
  callId: string
  callStatus: CallStatus
  customerName: string
  retailer: string
  state: string
  handoff: HandoffContext
}

export type HumanTurnResult = {
  call: CallSession
}

export type CallSession = {
  id: string
  journeyId: string
  status: CallStatus
  consentRecorded: boolean
  safetyScore: number
  provider: VoiceProviderId
  currentQuestionKey?: string
  repeatCount?: number
  startedAt?: string
  endedAt?: string
  utterances: Utterance[]
  handoff?: HandoffContext
}

export type AuditVerdict = "pass" | "fail" | "review"
export type AuditDecision = "auto-pass" | "hold" | "human-review"
export type AuditCheckType = "script" | "factual" | "behaviour"

export type AuditEvidence = {
  utteranceId: string
  startMs: number
  endMs: number
  quote: string
  correctValue?: string
}

export type AuditCheck = {
  id: string
  label: string
  type: AuditCheckType
  critical: boolean
  verdict: AuditVerdict
  confidence: number
  finding: string
  evidence: AuditEvidence[]
}

export type AuditRun = {
  id: string
  leadName: string
  agentName: string
  retailer: string
  recordingUrl?: string
  leadId?: string
  status: AuditDecision
  confidence: number
  aiSummary: string
  transcript: Utterance[]
  checks: AuditCheck[]
  override?: {
    auditor: string
    decision: AuditDecision
    reason: string
  }
}

export type PlatformProviderConfig = {
  voice: {
    active: VoiceProviderId
    mode: ProviderMode
    freeOptions: Array<{ id: VoiceProviderId; label: string; note: string }>
  }
  transcription: {
    active: TranscriptionProviderId
    mode: ProviderMode
    freeOptions: Array<{
      id: TranscriptionProviderId
      label: string
      note: string
    }>
  }
  llm: {
    active: LlmProviderId
    mode: ProviderMode
    freeOptions: Array<{ id: LlmProviderId; label: string; note: string }>
  }
}
