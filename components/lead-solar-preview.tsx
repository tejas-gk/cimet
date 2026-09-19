"use client"

import * as React from "react"
import {
  BotIcon,
  HeadphonesIcon,
  MicIcon,
  CircleStopIcon,
  PhoneForwardedIcon,
  SendIcon,
  Phone,
} from "lucide-react"
import { useVoiceRecorder, audioSrc } from "@/hooks/use-voice-recorder"
import { useSolarAgent } from "@/hooks/use-solar-agent"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Props = {
  onClose: () => void
  leadId?: string | null
  callId?: string | null
  initialAudio?: string | null
  onPlaceCall?: (leadId: string) => Promise<string | null>
  onExtractedData?: (data: Partial<Record<string, string>>) => void
  onSaveRecording?: (base64: string, transcript: string) => Promise<void>
}

const SPEAKER_LABEL: Record<string, string> = {
  user: "You",
  ai: "Priya · AI sales rep",
  "human-agent": "David · Human agent",
}

function speakerTone(speaker: string) {
  if (speaker === "user") return "ml-8 rounded-xl border-zinc-700 bg-[#141416]"
  if (speaker === "human-agent")
    return "mr-8 rounded-xl border-amber-500/30 bg-amber-500/10"
  return "mr-8 rounded-xl border-sky-500/30 bg-sky-500/10"
}

function speakerIcon(speaker: string) {
  if (speaker === "user") return <span className="size-4">🙂</span>
  if (speaker === "human-agent") return <HeadphonesIcon className="size-4" />
  return <BotIcon className="size-4" />
}

export default function LeadSolarPreview({
  onClose,
  leadId,
  callId,
  initialAudio,
  onPlaceCall,
  onExtractedData,
  onSaveRecording,
}: Props) {
  const basePath = React.useMemo(
    () => (callId ? `/api/calls/${callId}` : "/api/solar"),
    [callId]
  )
  const agent = useSolarAgent(basePath)
  // prepare leadContext from leadId if provided (parent can pass more data later)
  const [leadContext, setLeadContext] = React.useState<
    Record<string, string> | undefined
  >(undefined)

  React.useEffect(() => {
    if (!leadId) return
    // Minimal context: the lead id — the parent page can expand this if needed.
    setLeadContext({ leadId })
  }, [leadId])
  const recorder = useVoiceRecorder()
  const [answer, setAnswer] = React.useState("")
  const [speaking, setSpeaking] = React.useState(false)
  const [placing, setPlacing] = React.useState(false)

  const playTurns = React.useCallback(
    async (turns: Array<{ audioBase64: string | null }>) => {
      for (const turn of turns) {
        if (!turn.audioBase64) continue
        setSpeaking(true)
        await new Promise<void>((resolve) => {
          const audio = new Audio(audioSrc(turn.audioBase64!))
          audio.onended = () => resolve()
          audio.onerror = () => resolve()
          void audio.play().catch(() => resolve())
        })
      }
      setSpeaking(false)
    },
    []
  )

  const submitRef = React.useRef<(base64: string | null) => Promise<void>>(
    async () => {}
  )
  submitRef.current = async (base64: string | null) => {
    if (!base64) return
    const result = await agent.sendTurn({ audioBase64: base64, leadContext })
    if (result) {
      if (result.extractedData && onExtractedData)
        onExtractedData(result.extractedData)
      // Save the recording + transcript for this lead in preview mode
      if (onSaveRecording) {
        try {
          await onSaveRecording(base64, result.transcript)
        } catch (e) {
          console.warn("Failed to save preview recording", e)
        }
      }
      await playTurns(result.turns)
    }
  }

  const handleVoice = async () => {
    if (recorder.recording) {
      const base64 = await recorder.stop()
      await submitRef.current(base64)
      return
    }
    await recorder.start({
      onAutoStop: (base64) => void submitRef.current(base64),
      silenceMs: 1800,
      minRecordMs: 800,
      silenceLevel: 0.08,
    })
  }

  const handleText = async (raw: string) => {
    const text = raw.trim()
    if (!text) return
    setAnswer("")
    const result = await agent.sendTurn({ text, leadContext })
    if (result) {
      if (result.extractedData && onExtractedData)
        onExtractedData(result.extractedData)
      await playTurns(result.turns)
    }
  }

  const handleEscalate = async () => {
    const result = await agent.escalate()
    if (result) await playTurns(result.turns)
  }

  React.useEffect(() => {
    void (async () => {
      // If we're already attached to a call and the parent provided initial audio,
      // play that first and avoid calling agent.start() which would call /api/solar/start.
      if (callId && initialAudio) {
        await playTurns([{ audioBase64: initialAudio }])
        return
      }
      const greeting = await agent.start()
      if (greeting?.audioBase64) await playTurns([greeting])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, initialAudio])

  const handlePlaceCall = async () => {
    if (!leadId || !onPlaceCall) return
    setPlacing(true)
    try {
      const cid = await onPlaceCall(leadId)
      // parent will update callId and initialAudio; we don't need to do more here
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-xl border border-[#27272a] bg-[#0b0b0c] p-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">Solar preview</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-3">
          <div className="mb-2 text-xs text-zinc-400">Conversation</div>
          <div className="max-h-56 overflow-y-auto">
            {agent.messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "rounded-lg border p-3",
                  speakerTone(msg.speaker)
                )}
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs tracking-wide text-zinc-400 uppercase">
                  {speakerIcon(msg.speaker)} {SPEAKER_LABEL[msg.speaker]}
                </div>
                <div className="text-sm leading-6 text-zinc-100">
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-3">
            <Button
              className="flex-1"
              variant={recorder.recording ? "destructive" : "default"}
              onClick={() => void handleVoice()}
            >
              {recorder.recording ? (
                <CircleStopIcon className="size-4" />
              ) : (
                <MicIcon className="size-4" />
              )}{" "}
              {recorder.recording
                ? `Listening · ${Math.round(recorder.durationMs / 1000)}s`
                : "Tap to talk"}
            </Button>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#222226]">
              <div
                className="h-full rounded-full bg-sky-400"
                style={{ width: `${Math.max(4, recorder.level * 100)}%` }}
              />
            </div>
          </div>

          <div className="mt-2">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (answer.trim()) void handleText(answer)
              }}
              className="grid gap-2"
            >
              <Input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your reply…"
              />
              <div className="flex gap-2">
                <Button type="submit">
                  {" "}
                  <SendIcon className="size-4" /> Send
                </Button>
                <Button variant="outline" onClick={() => void handleEscalate()}>
                  <PhoneForwardedIcon className="size-4" /> Escalate
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handlePlaceCall()}
                  disabled={!leadId || placing}
                >
                  <Phone className="size-4" />{" "}
                  {placing
                    ? "Placing…"
                    : callId
                      ? `In call ${callId}`
                      : "Place call"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
