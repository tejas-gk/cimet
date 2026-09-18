/**
 * Server-only Sarvam AI client.
 *
 * This module must only ever be imported from Route Handlers / server code.
 * The subscription key stays in the server environment and is never exposed
 * to the browser bundle.
 *
 * API reference: https://docs.sarvam.ai
 */

export const SARVAM_MODELS = {
  insights: "sarvam-105b",
  voice: "sarvam-105b-conversations",
  stt: "saaras:v3",
  tts: "bulbul:v3",
} as const

export type ChatMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type SpeechToTextChunk = {
  text: string
  startMs: number
  endMs: number
}

export type SpeechToTextResult = {
  transcript: string
  chunks: SpeechToTextChunk[]
  requestId?: string
}

export type TextToSpeechResult = {
  audio: Buffer
  mime: string
}

export class SarvamApiError extends Error {
  status: number
  requestId?: string

  constructor(message: string, status: number, requestId?: string) {
    super(message)
    this.name = "SarvamApiError"
    this.status = status
    this.requestId = requestId
  }
}

function apiKey(): string {
  const key = process.env.SARVAM_API_KEY
  if (!key) {
    throw new Error(
      "SARVAM_API_KEY is not configured. Add it to your .env file (server-side only)."
    )
  }
  return key
}

async function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs = 60_000
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`https://api.sarvam.ai${path}`, {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    throw new SarvamApiError(
      `Sarvam request to ${path} failed: ${
        error instanceof Error ? error.message : "network error"
      }`,
      0
    )
  } finally {
    clearTimeout(timer)
  }

  const raw = await response.text()
  let data: unknown = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = raw
  }

  if (!response.ok) {
    const error =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { message?: string; request_id?: string } }).error
        : undefined
    throw new SarvamApiError(
      error?.message ?? `Sarvam ${path} returned ${response.status}`,
      response.status,
      error?.request_id
    )
  }

  return data as T
}

/**
 * Run a chat completion. Pass `schema` to force Strict structured JSON output,
 * or `json: true` for plain JSON mode.
 */
export async function chatCompletion(opts: {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  json?: boolean
  schema?: Record<string, unknown>
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model ?? SARVAM_MODELS.insights,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 1600,
    reasoning_effort: "low",
  }
  if (opts.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: opts.schema,
    }
  } else if (opts.json) {
    body.response_format = { type: "json_object" }
  }

  type ChatResponse = {
    choices?: Array<{
      message?: { content?: string | null }
      finish_reason?: string
    }>
    error?: { message?: string }
  }

  const data = await postJson<ChatResponse>("/v1/chat/completions", body)
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    const reason = data.choices?.[0]?.finish_reason ?? "unknown"
    throw new SarvamApiError(
      `Model returned no content (finish_reason=${reason})`,
      200
    )
  }
  return content
}

function extractJsonObject<T>(content: string): T {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : trimmed
  const start = candidate.search(/[{[]/)
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"))
  if (start === -1 || end === -1) {
    throw new SarvamApiError(`Model output is not JSON: ${content.slice(0, 200)}`, 200)
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T
  } catch {
    throw new SarvamApiError(`Could not parse model JSON: ${content.slice(0, 200)}`, 200)
  }
}

/** Chat completion that must return a JSON object (parsed for convenience). */
export async function chatJson<T>(opts: {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
}): Promise<T> {
  const content = await chatCompletion({ ...opts, json: true })
  return extractJsonObject<T>(content)
}

/**
 * Transcribe an audio buffer. Uses chunk-level timestamps so caller-turn
 * boundaries can be recovered downstream.
 */
export async function speechToText(input: {
  audio: Buffer
  filename?: string
  mime?: string
  languageCode?: string
  maxChunkSeconds?: number
  timeoutMs?: number
}): Promise<SpeechToTextResult> {
  const key = apiKey()
  const form = new FormData()
  form.append(
    "file",
    new Blob([input.audio.buffer as ArrayBuffer], {
      type: input.mime ?? "audio/wav",
    }),
    input.filename ?? "audio.wav"
  )
  form.append("model", SARVAM_MODELS.stt)
  form.append("language_code", input.languageCode ?? "en-IN")
  form.append("mode", "transcribe")
  form.append("with_timestamps", "true")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000)
  let response: Response
  try {
    response = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
      signal: controller.signal,
    })
  } catch (error) {
    throw new SarvamApiError(
      `Sarvam speech-to-text failed: ${
        error instanceof Error ? error.message : "network error"
      }`,
      0
    )
  } finally {
    clearTimeout(timer)
  }

  const raw = await response.text()
  let data: unknown = null
  try {
    data = JSON.parse(raw)
  } catch {
    data = raw
  }

  if (!response.ok) {
    const error =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { message?: string; request_id?: string } }).error
        : undefined
    throw new SarvamApiError(
      error?.message ?? `Sarvam speech-to-text returned ${response.status}`,
      response.status,
      error?.request_id
    )
  }

  type SttResponse = {
    transcript?: string
    request_id?: string
    timestamps?: {
      words?: string[]
      start_time_seconds?: number[]
      end_time_seconds?: number[]
    } | null
  }

  const payload = data as SttResponse
  const transcript = payload.transcript ?? ""
  const words = payload.timestamps?.words ?? []
  const starts = payload.timestamps?.start_time_seconds ?? []
  const ends = payload.timestamps?.end_time_seconds ?? []

  const chunks: SpeechToTextChunk[] = words.map((text, index) => ({
    text,
    startMs: Math.round((starts[index] ?? 0) * 1000),
    endMs: Math.round((ends[index] ?? starts[index] ?? 0) * 1000),
  }))

  return {
    transcript,
    chunks,
    requestId: payload.request_id,
  }
}

/**
 * Convert text to spoken audio (WAV @ 16kHz by default).
 */
export async function textToSpeech(input: {
  text: string
  speaker?: string
  sampleRate?: 8000 | 16000 | 22050 | 24000
  codec?: "wav" | "mp3" | "opus" | "flac" | "aac" | "linear16"
  timeoutMs?: number
}): Promise<TextToSpeechResult> {
  type TtsResponse = {
    audios?: string[]
    error?: { message?: string }
  }

  const data = await postJson<TtsResponse>(
    "/text-to-speech",
    {
      text: input.text,
      language_code: "en-IN",
      speaker: input.speaker ?? "shubh",
      model: SARVAM_MODELS.tts,
      output_audio_codec: input.codec ?? "wav",
      speech_sample_rate: String(input.sampleRate ?? 16000),
    },
    input.timeoutMs ?? 90_000
  )

  if (!data.audios) {
    throw new SarvamApiError(data.error?.message ?? "Sarvam TTS returned no audio", 200)
  }

  const audio = Buffer.from(data.audios.join(""), "base64")
  return {
    audio,
    mime: `audio/${input.codec ?? "wav"}`,
  }
}