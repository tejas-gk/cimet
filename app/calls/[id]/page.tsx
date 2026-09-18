"use client"

import { AlertTriangleIcon, CheckCircle2Icon, CircleStopIcon, MicIcon, PhoneCallIcon, PhoneForwardedIcon, SendIcon } from "lucide-react"
import { useParams } from "next/navigation"
import * as React from "react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCimetAi } from "@/hooks/use-cimet-ai"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import type { HandoffReason } from "@/lib/cimet-ai-types"

const reasons: Array<{ value: HandoffReason; label: string }> = [
  { value: "asked-for-human", label: "Asked for human" },
  { value: "angry-customer", label: "Angry customer" },
  { value: "low-confidence", label: "Low confidence" },
  { value: "out-of-scope", label: "Out of scope" },
  { value: "sensitive-topic", label: "Sensitive topic" },
  { value: "repeated-misunderstanding", label: "Repeated misunderstanding" },
]

const MAX_RECORDING_MS = 30_000

export default function CallDetailPage() {
  const params = useParams<{ id: string }>()
  const { getCall, getJourney, startCall, sendTurn, triggerHandoff } = useCimetAi()
  const recorder = useVoiceRecorder()
  const [answer, setAnswer] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [handoffReason, setHandoffReason] = React.useState<HandoffReason>("asked-for-human")
  const autoStopTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const call = getCall(params.id)
  const journey = call ? getJourney(call.journeyId) : null
  const currentField = journey?.fields.find((field) => field.key === call?.currentQuestionKey)
  const callActive = !!call && ["consent", "collecting"].includes(call.status)

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

  React.useEffect(() => {
    if (recorder.error) setError(recorder.error)
  }, [recorder.error])

  const handleStart = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await startCall(call!.id)
      if (result.audioBase64) recorder.play(result.audioBase64)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start the call")
    } finally {
      setBusy(false)
    }
  }

  const handleVoice = async () => {
    if (recorder.recording) {
      const base64 = await recorder.stop()
      if (!base64 || !call) return
      setBusy(true)
      setError(null)
      try {
        const result = await sendTurn(call.id, { audioBase64: base64 })
        if (result.audioBase64) recorder.play(result.audioBase64)
      } catch (err) {
        setError(err instanceof Error ? err.message : "The agent could not process that recording")
      } finally {
        setBusy(false)
      }
      return
    }
    setError(null)
    await recorder.start()
  }

  const handleText = async (value: string) => {
    const text = value.trim()
    if (!text || !call) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendTurn(call.id, { text })
      setAnswer("")
      if (result.audioBase64) recorder.play(result.audioBase64)
    } catch (err) {
      setError(err instanceof Error ? err.message : "The agent could not process that answer")
    } finally {
      setBusy(false)
    }
  }

  if (!call || !journey) {
    return (
      <CimetAiShell>
        <div className="mx-auto grid max-w-7xl gap-5">
          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-6 text-sm text-zinc-400">
            Call not found. Go back to the <a className="text-sky-300" href="/calls">voice agent list</a>.
          </div>
        </div>
      </CimetAiShell>
    )
  }

  const controlsDisabled = busy || !callActive || recorder.recording

  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="grid gap-5">
          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Badge variant="outline" className="mb-2 border-sky-500/30 bg-sky-500/10 text-sky-200">Live AI Voice Agent</Badge>
                <h2 className="text-2xl font-semibold">{journey.customerName}</h2>
                <div className="mt-1 text-sm text-zinc-400">{journey.phone} · {journey.email}</div>
              </div>
              <Badge variant="outline" className="border-[#34363a] bg-[#111113] text-zinc-200">{call.status}</Badge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm"><div className="text-zinc-500">Retailer</div><div>{journey.retailer}</div></div>
              <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm"><div className="text-zinc-500">Abandoned at</div><div>{journey.abandonStep}</div></div>
              <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm"><div className="text-zinc-500">Consent</div><div>{call.consentRecorded ? "Recorded" : "Pending"}</div></div>
              <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm"><div className="text-zinc-500">Repeat count</div><div>{call.repeatCount ?? 0}</div></div>
            </div>
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c]">
            <div className="border-b border-[#27272a] p-4 font-medium">Conversation transcript</div>
            <div className="grid max-h-[520px] gap-3 overflow-y-auto p-4">
              {call.utterances.length === 0 ? <div className="text-sm text-zinc-500">No call activity yet. Start the live call below.</div> : null}
              {call.utterances.map((utterance) => (
                <div key={utterance.id} className={utterance.speaker === "ai" ? "mr-10 rounded-lg border border-sky-500/20 bg-sky-500/10 p-3" : "ml-10 rounded-lg border border-zinc-700 bg-[#141416] p-3"}>
                  <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">{utterance.speaker}</div>
                  <div className="text-sm leading-6 text-zinc-100">{utterance.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid content-start gap-5">
          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
            <h3 className="font-medium">Live talk</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Your voice is transcribed with real Sarvam STT and replies are synthesised with Sarvam TTS.
            </p>

            {busy ? (
              <div className="mt-4 rounded-lg border border-sky-500/20 bg-sky-500/10 p-4 text-center text-sm text-sky-200">
                Agent is listening…
              </div>
            ) : null}

            {call.status === "queued" ? (
              <Button className="mt-4 w-full" onClick={handleStart} disabled={busy}>
                <PhoneCallIcon className="size-4" /> Start live call
              </Button>
            ) : callActive ? (
              <div className="mt-4 grid gap-3">
                <div className="flex items-center gap-3">
                  <Button
                    className="flex-1"
                    variant={recorder.recording ? "destructive" : "default"}
                    onClick={() => void handleVoice()}
                    disabled={busy}
                  >
                    {recorder.recording ? <CircleStopIcon className="size-4" /> : <MicIcon className="size-4" />}
                    {recorder.recording ? `Stop · ${Math.round(recorder.durationMs / 1000)}s` : "Record your answer"}
                  </Button>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#222226]">
                    <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${Math.max(4, recorder.level * 100)}%` }} />
                  </div>
                </div>

                {call.status === "consent" ? (
                  <div className="grid gap-2 text-center text-xs text-zinc-500">
                    The agent just asked for consent. Say “yes” or “no”, or tap:
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" className="border-[#34363a] bg-[#111113] text-white" disabled={controlsDisabled} onClick={() => void handleText("Yes, that is okay.")}>
                        <CheckCircle2Icon className="size-4" /> Consent yes
                      </Button>
                      <Button size="sm" variant="outline" className="border-[#34363a] bg-[#111113] text-white" disabled={controlsDisabled} onClick={() => void handleText("No, please do not call me again.")}>
                        Consent no
                      </Button>
                    </div>
                  </div>
                ) : null}

                {call.status === "collecting" && currentField ? (
                  <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-xs text-zinc-400">
                    Currently collecting: <span className="text-zinc-100">{currentField.label}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {error ? <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

            {callActive ? (
              <form
                className="mt-4 grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!answer.trim() || busy) return
                  void handleText(answer)
                }}
              >
                <label className="text-xs text-zinc-500">Text fallback (types the customer&apos;s answer directly)</label>
                <Input
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  className="border-[#27272a] bg-[#111113] text-white"
                  placeholder="Type the customer's spoken answer…"
                  disabled={controlsDisabled}
                />
                <Button type="submit" disabled={controlsDisabled || !answer.trim()}>
                  <SendIcon className="size-4" /> Send typed answer
                </Button>
              </form>
            ) : null}
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
            <h3 className="font-medium">Journey fields</h3>
            <div className="mt-3 grid gap-2">
              {journey.fields.map((field) => (
                <div key={field.key} className="flex items-center justify-between gap-3 rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm">
                  <div><div>{field.label}</div><div className="text-xs text-zinc-500">{field.required ? "Required" : "Optional"}</div></div>
                  <Badge variant="outline" className={field.value ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}>{field.value ?? "missing"}</Badge>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 font-medium text-amber-200"><AlertTriangleIcon className="size-4" /> Warm handoff</div>
            <p className="mt-2 text-sm text-amber-100/70">Approving hands the current context bundle to a human agent.</p>
            <div className="mt-3 grid gap-2">
              <Select value={handoffReason} onValueChange={(value) => setHandoffReason(value as HandoffReason)} disabled={busy}>
                <SelectTrigger className="border-[#34363a] bg-[#111113] text-white"><SelectValue /></SelectTrigger>
                <SelectContent>{reasons.map((reason) => <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-100"
                disabled={busy || !callActive}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await triggerHandoff(call.id, handoffReason)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to prepare handoff")
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <PhoneForwardedIcon className="size-4" /> Prepare human handoff
              </Button>
            </div>
            {call.handoff ? (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-[#14100a] p-3 text-sm text-amber-50/80">
                <div className="font-medium text-amber-100">Context bundle ready</div>
                <div className="mt-1">Reason: {call.handoff.reason}</div>
                <div className="mt-1">Summary: {call.handoff.summary}</div>
                <div className="mt-1">Remaining: {call.handoff.remaining.join(", ") || "none"}</div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </CimetAiShell>
  )
}