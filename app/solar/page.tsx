"use client"

import {
  BotIcon,
  CircleStopIcon,
  HeadphonesIcon,
  MicIcon,
  PhoneForwardedIcon,
  RefreshCwIcon,
  SendIcon,
  SunIcon,
  UserIcon,
} from "lucide-react"
import * as React from "react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { audioSrc, useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { useSolarAgent } from "@/hooks/use-solar-agent"
import type { SolarMessage } from "@/hooks/use-solar-agent"
import { cn } from "@/lib/utils"

const MAX_RECORDING_MS = 30_000

const SPEAKER_LABEL: Record<SolarMessage["speaker"], string> = {
  user: "You",
  ai: "Priya · AI sales rep",
  "human-agent": "David · Human agent",
}

function speakerTone(speaker: SolarMessage["speaker"]) {
  if (speaker === "user") return "ml-8 rounded-xl border-zinc-700 bg-[#141416]"
  if (speaker === "human-agent")
    return "mr-8 rounded-xl border-amber-500/30 bg-amber-500/10"
  return "mr-8 rounded-xl border-sky-500/30 bg-sky-500/10"
}

function speakerIcon(speaker: SolarMessage["speaker"]) {
  if (speaker === "user") return <UserIcon className="size-4" />
  if (speaker === "human-agent") return <HeadphonesIcon className="size-4" />
  return <BotIcon className="size-4" />
}

export default function SolarSalesPage() {
  const agent = useSolarAgent()
  const recorder = useVoiceRecorder()
  const autoStopTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [answer, setAnswer] = React.useState("")
  const [speaking, setSpeaking] = React.useState(false)
  const [humanConnected, setHumanConnected] = React.useState(false)
  const [humanError, setHumanError] = React.useState<string | null>(null)

  const busy = agent.busy || recorder.busy
  const active = agent.phase === "connected" || agent.phase === "handed-off"

  React.useEffect(() => {
    if (recorder.recording) {
      autoStopTimer.current = setTimeout(() => {
        void recorder.stop()
      }, MAX_RECORDING_MS)
    }
    return () => {
      if (autoStopTimer.current) clearTimeout(autoStopTimer.current)
    }
  }, [recorder.recording, recorder.stop])

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
    const result = await agent.sendTurn({ audioBase64: base64 })
    if (result) await playTurns(result.turns)
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
    const result = await agent.sendTurn({ text })
    if (result) await playTurns(result.turns)
  }

  const handleEscalate = async () => {
    const result = await agent.escalate()
    if (result) {
      await playTurns(result.turns)
      setHumanConnected(true)
    } else {
      setHumanError("Failed to escalate call")
    }
  }

  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        {/* ── Left column ─────────────────────────────────────────────── */}
        <div className="grid min-w-0 gap-5">
          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Badge
                  variant="outline"
                  className="mb-2 border-amber-500/30 bg-amber-500/10 text-amber-200"
                >
                  <SunIcon className="size-3.5" /> Solar voice sales demo
                </Badge>
                <h2 className="text-2xl font-semibold">
                  Talk to the solar sales agent
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-zinc-400">
                  Real Sarvam STT + LLM + TTS. Priya sells rooftop solar;
                  request a human and the call is handed to David with full
                  context.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {agent.phase === "handed-off" ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  >
                    <PhoneForwardedIcon className="size-3.5" /> Handed to human
                  </Badge>
                ) : active ? (
                  <Badge
                    variant="outline"
                    className="border-sky-500/40 bg-sky-500/10 text-sky-300"
                  >
                    Live call
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#34363a] bg-[#111113] text-white"
                  onClick={() => {
                    if (recorder.recording) void recorder.stop()
                    agent.reset()
                  }}
                  disabled={busy}
                >
                  <RefreshCwIcon className="size-4" /> New call
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm">
                <div className="text-zinc-500">Outbound rep</div>
                <div className="flex items-center gap-1.5">
                  <BotIcon className="size-4 text-sky-300" /> Priya (AI)
                </div>
              </div>
              <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm">
                <div className="text-zinc-500">Human escalation</div>
                <div className="flex items-center gap-1.5">
                  <HeadphonesIcon className="size-4 text-amber-300" /> David
                </div>
              </div>
              <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm">
                <div className="text-zinc-500">Voice stack</div>
                <div className="flex items-center gap-1.5">
                  <SunIcon className="size-4 text-amber-300" /> Sarvam · live
                </div>
              </div>
            </div>
          </div>

          {/* Transcript */}
          <div className="overflow-hidden rounded-xl border border-[#27272a] bg-[#0b0b0c]">
            <div className="flex items-center justify-between border-b border-[#27272a] p-4">
              <div className="font-medium">Conversation transcript</div>
              {speaking ? (
                <Badge
                  variant="outline"
                  className="border-sky-500/40 text-sky-300"
                >
                  Agent speaking…
                </Badge>
              ) : null}
            </div>
            <div className="grid max-h-[540px] gap-3 overflow-y-auto p-4">
              {agent.messages.length === 0 ? (
                <div className="grid place-items-center gap-3 rounded-lg border border-dashed border-[#27272a] py-14 text-center text-sm text-zinc-500">
                  <div className="flex size-14 items-center justify-center rounded-full bg-[#141416] text-zinc-400">
                    <PhoneForwardedIcon className="size-6" />
                  </div>
                  <div className="max-w-xs">
                    Press <span className="text-zinc-300">Start call</span> to
                    hear Priya&apos;s greeting, then talk — the mic stops
                    automatically when you pause.
                  </div>
                </div>
              ) : null}
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
        </div>

        {/* ── Right column ────────────────────────────────────────────── */}
        <div className="grid content-start gap-5">
          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
            <h3 className="font-medium">Live talk</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Your voice is transcribed with Sarvam STT; every reply is
              synthesised with Sarvam TTS and played back. Recording stops
              automatically after a short pause so the agent can respond.
            </p>

            {busy ? (
              <div className="mt-4 mb-3 rounded-lg border border-sky-500/20 bg-sky-500/10 p-4 text-center text-sm text-sky-200">
                Agent is listening…
              </div>
            ) : null}

            {speaking ? (
              <div className="mt-4 mb-3 rounded-lg border border-sky-500/20 bg-sky-500/10 p-4 text-center text-sm text-sky-200">
                Agent is speaking…
              </div>
            ) : null}

            {agent.phase === "idle" ? (
              <Button
                className="mt-4 w-full"
                onClick={async () => {
                  const turn = await agent.start()
                  if (turn?.audioBase64)
                    await playTurns([{ audioBase64: turn.audioBase64 }])
                }}
                disabled={busy}
              >
                <MicIcon className="size-4" /> Start call
              </Button>
            ) : (
              <div className="mt-4 grid gap-3">
                <div className="flex items-center gap-3">
                  <Button
                    className="flex-1"
                    variant={recorder.recording ? "destructive" : "default"}
                    onClick={() => void handleVoice()}
                    disabled={busy}
                  >
                    {recorder.recording ? (
                      <CircleStopIcon className="size-4" />
                    ) : (
                      <MicIcon className="size-4" />
                    )}
                    {recorder.recording
                      ? `Listening · ${Math.round(recorder.durationMs / 1000)}s`
                      : "Tap to talk"}
                  </Button>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#222226]">
                    <div
                      className="h-full rounded-full bg-sky-400 transition-all"
                      style={{ width: `${Math.max(4, recorder.level * 100)}%` }}
                    />
                  </div>
                </div>

                {recorder.recording ? (
                  <div className="text-center text-xs text-zinc-500">
                    Pause when you&apos;re done — it sends automatically.
                  </div>
                ) : null}

                {agent.phase === "connected" ? (
                  <Button
                    variant="outline"
                    className="w-full border-amber-500/40 bg-amber-500/10 text-amber-100"
                    onClick={() => void handleEscalate()}
                    disabled={busy}
                  >
                    <PhoneForwardedIcon className="size-4" /> “I want to speak
                    to a human”
                  </Button>
                ) : null}

                {agent.phase === "handed-off" ? (
                  humanConnected ? (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                      <div className="font-medium text-emerald-200">
                        Connected to David (human agent)
                      </div>
                      <div className="mt-1">
                        Continue talking — the human consultant has the full
                        context.
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                      <div className="flex items-center gap-2 font-medium">
                        <HeadphonesIcon className="size-4" />

                        {humanConnected
                          ? "Live with human agent"
                          : "Human handoff"}
                      </div>

                      <div className="mt-1 text-sm text-zinc-400">
                        {humanConnected
                          ? "Direct live audio. AI, STT and TTS are no longer in the conversation."
                          : "Waiting for a human agent to accept…"}
                      </div>

                      {humanError && (
                        <div className="mt-3 text-sm text-red-400">
                          {humanError}
                        </div>
                      )}

                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.location.href = "/agents"}
                        >
                          View human agents
                        </Button>
                      </div>
                    </div>
                  )
                ) : null}
              </div>
            )}

            {agent.error || recorder.error ? (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {agent.error ?? recorder.error}
              </div>
            ) : null}

            {agent.phase !== "idle" ? (
              <form
                className="mt-4 grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!answer.trim() || busy) return
                  void handleText(answer)
                }}
              >
                <label className="text-xs text-zinc-500">
                  Text fallback (types your answer directly)
                </label>
                <Input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  className="border-[#27272a] bg-[#111113] text-white"
                  placeholder="Type your reply…"
                  disabled={busy}
                />
                <Button type="submit" disabled={busy || !answer.trim()}>
                  <SendIcon className="size-4" /> Send typed answer
                </Button>
              </form>
            ) : null}
          </div>

          {agent.handoff ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 font-medium text-amber-200">
                <PhoneForwardedIcon className="size-4" /> Warm handoff bundle
              </div>
              <div className="mt-2 grid gap-2 text-sm">
                <div>
                  <span className="text-zinc-500">Reason:</span>{" "}
                  <span className="text-zinc-100">{agent.handoff.reason}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Summary:</span>{" "}
                  <span className="text-zinc-100">{agent.handoff.summary}</span>
                </div>
                {agent.handoff.collected &&
                agent.handoff.collected.length > 0 ? (
                  <div className="grid gap-1.5">
                    <div className="text-zinc-500">Collected so far:</div>
                    {agent.handoff.collected.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded-lg border border-[#242427] bg-[#111113] px-3 py-2 text-xs"
                      >
                        <span className="text-zinc-400">{item.label}</span>
                        <span className="text-zinc-100">{item.value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </CimetAiShell>
  )
}
