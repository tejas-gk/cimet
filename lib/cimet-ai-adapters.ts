import type {
  CallSession,
  EnergyJourney,
  HandoffContext,
  PlatformProviderConfig,
  Utterance,
} from "@/lib/cimet-ai-types"

export const providerConfig: PlatformProviderConfig = {
  voice: {
    active: "mock",
    mode: "mock",
    freeOptions: [
      { id: "mock", label: "Mock simulator", note: "Free local demo; no phone call leaves the browser." },
      { id: "vapi", label: "Vapi", note: "Fastest real outbound-call integration; use trial credits if available." },
      { id: "twilio-realtime", label: "Twilio + Realtime", note: "Plug in Twilio Voice plus an LLM realtime API when credentials exist." },
      { id: "livekit", label: "LiveKit", note: "Open-source WebRTC layer; useful for web-call demos and human takeover." },
    ],
  },
  transcription: {
    active: "mock",
    mode: "mock",
    freeOptions: [
      { id: "mock", label: "Mock transcript", note: "Free fixture transcripts with speakers and timestamps." },
      { id: "deepgram", label: "Deepgram", note: "Good diarization/timestamps; trial credits are commonly available." },
      { id: "assemblyai", label: "AssemblyAI", note: "Speaker labels and summaries; trial tier works for hack demos." },
      { id: "whisper-local", label: "Local Whisper", note: "Free self-hosted transcription; add pyannote/whisperX for diarization." },
    ],
  },
  llm: {
    active: "mock",
    mode: "mock",
    freeOptions: [
      { id: "mock", label: "Rules + fixtures", note: "Free deterministic demo decisions; no API key." },
      { id: "gemini", label: "Gemini", note: "Generous free tier for structured extraction/checks." },
      { id: "ollama", label: "Ollama", note: "Free local LLM for offline demos; best for non-realtime flows." },
      { id: "openai", label: "OpenAI", note: "Best realtime voice/check accuracy when paid credits exist." },
    ],
  },
}

export interface VoiceAgentAdapter {
  placeCall(journey: EnergyJourney): Promise<CallSession>
  sendCustomerTurn(callId: string, text: string): Promise<Utterance>
  requestHandoff(callId: string, context: HandoffContext): Promise<void>
}

export interface TranscriptionAdapter {
  transcribe(recordingUrl: string): Promise<Utterance[]>
}

export interface LlmDecisionAdapter {
  extractJourneyField(prompt: string, answer: string): Promise<{ value: string; confidence: number }>
  classifySafety(utterance: string): Promise<{ safeToContinue: boolean; reason?: string; confidence: number }>
}

export const integrationNotes = [
  "Start in mock mode for a free demo; swap adapters provider-by-provider later.",
  "Keep all third-party credentials server-side; the client only calls your own API.",
  "Use structured JSON outputs for every LLM decision so audits are reproducible.",
  "Persist every model decision, confidence score, and human override for QA agreement reporting.",
]
