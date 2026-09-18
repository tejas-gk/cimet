"use client"

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleStopIcon,
  ClipboardListIcon,
  Loader2Icon,
  MicIcon,
  PhoneCallIcon,
  PhoneForwardedIcon,
  SendIcon,
  ShieldCheckIcon,
  TimerIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCimetAi } from "@/hooks/use-cimet-ai"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import type { AuditRun, HandoffReason } from "@/lib/cimet-ai-types"

const reasons: Array<{ value: HandoffReason; label: string }> = [
  { value: "asked-for-human", label: "Asked for human" },
  { value: "angry-customer", label: "Angry customer" },
  { value: "low-confidence", label: "Low confidence" },
  { value: "out-of-scope", label: "Out of scope" },
  { value: "sensitive-topic", label: "Sensitive topic" },
  { value: "repeated-misunderstanding", label: "Repeated misunderstanding" },
]

const MAX_RECORDING_MS = 30_000
const IDLE_END_MS = 12_000

function qaBadge(status: AuditRun["status"]) {
  if (status === "auto-pass") return "border-emerald-500/40 text-emerald-300"
  if (status === "hold") return "border-red-500/40 text-red-300"
  if (status === "human-review") return "border-amber-500/40 text-amber-300"
  return "border-[#34363a] text-zinc-400"
}

export function VoiceAgentDetail({ callId }: { callId: string }) {
  const {
    getCall,
    getJourney,
    startCall,
    sendTurn,
    triggerHandoff,
    endCallSilently,
    fetchCallAudit,
    runCallAuditNow,
  } = useCimetAi()
  const recorder = useVoiceRecorder()
  const [answer, setAnswer] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)
  const [handoffReason, setHandoffReason] =
    React.useState<HandoffReason>("asked-for-human")
  const recordTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityRef = React.useRef(Date.now())
  const idleFiredRef = React.useRef(false)

  // Post-call quality audit state
  const [audit, setAudit] = React.useState<AuditRun | null>(null)
  const [auditFetching, setAuditFetching] = React.useState(false)

  const call = getCall(callId)
  const journey = call ? getJourney(call.journeyId) : null
  const currentField = journey?.fields.find(
    (field) => field.key === call?.currentQuestionKey
  )
  const callActive = !!call && ["consent", "collecting"].includes(call.status)

  // Hard max for any single recording.
  React.useEffect(() => {
    if (recorder.recording) {
      recordTimer.current = setTimeout(
        () => void recorder.stop(),
        MAX_RECORDING_MS
      )
    }
    return () => {
      if (recordTimer.current) clearTimeout(recordTimer.current)
    }
  }, [recorder.recording, recorder.stop])

  React.useEffect(() => {
    if (recorder.error) setError(recorder.error)
  }, [recorder.error])

  // Reset activity clock on each agent reply or user action.
  React.useEffect(() => {
    lastActivityRef.current = Date.now()
  }, [call?.utterances.length, call?.status])

  // Idle timer: a long pause from the user means stop.
  React.useEffect(() => {
    if (!callActive) return
    const iv = setInterval(() => {
      if (
        !idleFiredRef.current &&
        Date.now() - lastActivityRef.current > IDLE_END_MS
      ) {
        idleFiredRef.current = true
        setNote("Long pause detected — wrapping up the call per policy.")
        void endCallSilently(callId)
          .then((result) => {
            if (result.audit) setAudit(result.audit)
          })
          .catch(() => setError("Failed to end call automatically"))
      }
    }, 2000)
    return () => clearInterval(iv)
  }, [callActive, callId, endCallSilently])

  // Whenever the call finishes, poll for its post-call audit and surface it.
  React.useEffect(() => {
    if (!call) return
    if (callActive) {
      setAudit(null)
      setAuditFetching(false)
      return
    }
    if (!call.endedAt) return
    let cancelled = false
    let attempts = 0
    const poll = async () => {
      const existing = await fetchCallAudit(call.id)
      if (cancelled) return
      if (existing) {
        setAudit(existing)
        setAuditFetching(false)
        return
      }
      attempts += 1
      if (attempts < 20) setTimeout(poll, 3000)
      else setAuditFetching(false)
    }
    setAuditFetching(true)
    void poll()
    return () => {
      cancelled = true
    }
  }, [call?.id, call?.endedAt, callActive, fetchCallAudit])

  // --- handlers -----------------------------------------------------------

  const sendRecording = React.useCallback(
    async (base64: string | null) => {
      if (!base64 || !call) return
      setBusy(true)
      setError(null)
      try {
        const result = await sendTurn(call.id, { audioBase64: base64 })
        if (result.audit) setAudit(result.audit)
        if (result.audioBase64) recorder.play(result.audioBase64)
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "The agent could not process that recording"
        )
      } finally {
        setBusy(false)
      }
    },
    [call, sendTurn, recorder]
  )

  const handleStart = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await startCall(call!.id)
      lastActivityRef.current = Date.now()
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
      await sendRecording(base64)
      return
    }
    setError(null)
    lastActivityRef.current = Date.now()
    await recorder.start({ onAutoStop: (base64) => void sendRecording(base64) })
  }

  const handleText = async (value: string) => {
    const text = value.trim()
    if (!text || !call) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendTurn(call.id, { text })
      if (result.audit) setAudit(result.audit)
      lastActivityRef.current = Date.now()
      setAnswer("")
      if (result.audioBase64) recorder.play(result.audioBase64)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The agent could not process that answer"
      )
    } finally {
      setBusy(false)
    }
  }

  // --- render -------------------------------------------------------------

  if (!call || !journey) {
    return (
      <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-6 text-sm text-zinc-400">
        Call not found. Go back to the{" "}
        <a className="text-sky-300" href="/calls">
          voice agent list
        </a>
        .
      </div>
    )
  }

  const controlsDisabled = busy || !callActive || recorder.recording

  return (
    <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="grid gap-5">
        <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge
                variant="outline"
                className="mb-2 border-sky-500/30 bg-sky-500/10 text-sky-200"
              >
                Live AI Voice Agent
              </Badge>
              <h2 className="text-2xl font-semibold">{journey.customerName}</h2>
              <div className="mt-1 text-sm text-zinc-400">
                {journey.phone} · {journey.email}
              </div>
            </div>
            <Badge
              variant="outline"
              className="border-[#34363a] bg-[#111113] text-zinc-200"
            >
              {call.status}
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm">
              <div className="text-zinc-500">Retailer</div>
              <div>{journey.retailer}</div>
            </div>
            <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm">
              <div className="text-zinc-500">Abandoned at</div>
              <div>{journey.abandonStep}</div>
            </div>
            <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm">
              <div className="text-zinc-500">Consent</div>
              <div>{call.consentRecorded ? "Recorded" : "Pending"}</div>
            </div>
            <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm">
              <div className="text-zinc-500">Repeat count</div>
              <div>{call.repeatCount ?? 0}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c]">
          <div className="border-b border-[#27272a] p-4 font-medium">
            Conversation transcript
          </div>
          <div className="grid max-h-[520px] gap-3 overflow-y-auto p-4">
            {call.utterances.length === 0 ? (
              <div className="text-sm text-zinc-500">
                No call activity yet. Start the live call below.
              </div>
            ) : null}
            {call.utterances.map((utterance) => (
              <div
                key={utterance.id}
                className={
                  utterance.speaker === "ai"
                    ? "mr-10 rounded-lg border border-sky-500/20 bg-sky-500/10 p-3"
                    : "ml-10 rounded-lg border border-zinc-700 bg-[#141416] p-3"
                }
              >
                <div className="mb-1 text-xs tracking-wide text-zinc-500 uppercase">
                  {utterance.speaker}
                </div>
                <div className="text-sm leading-6 text-zinc-100">
                  {utterance.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid content-start gap-5">
        {/* ─── Live talk controls ─── */}
        <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
          <h3 className="font-medium">Live talk</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Your voice is transcribed with real Sarvam STT and replies are
            synthesised with Sarvam TTS.
          </p>

          {busy ? (
            <div className="mt-4 rounded-lg border border-sky-500/20 bg-sky-500/10 p-4 text-center text-sm text-sky-200">
              Agent is listening…
            </div>
          ) : null}

          {call.status === "queued" ? (
            <Button
              className="mt-4 w-full"
              onClick={handleStart}
              disabled={busy}
            >
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
                  {recorder.recording ? (
                    <CircleStopIcon className="size-4" />
                  ) : (
                    <MicIcon className="size-4" />
                  )}
                  {recorder.recording
                    ? `Stop · ${Math.round(recorder.durationMs / 1000)}s`
                    : "Record your answer"}
                </Button>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#222226]">
                  <div
                    className="h-full rounded-full bg-sky-400 transition-all"
                    style={{ width: `${Math.max(4, recorder.level * 100)}%` }}
                  />
                </div>
              </div>

              {recorder.recording ? (
                <p className="text-center text-xs text-zinc-500">
                  Recording — long silence will end the call.
                </p>
              ) : null}

              {call.status === "consent" ? (
                <div className="grid gap-2 text-center text-xs text-zinc-500">
                  The agent just asked for consent. Say &ldquo;yes&rdquo; or
                  &ldquo;no&rdquo;, or tap:
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-[#34363a] bg-[#111113] text-white"
                      disabled={controlsDisabled}
                      onClick={() => void handleText("Yes, that is okay.")}
                    >
                      <CheckCircle2Icon className="size-4" /> Consent yes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-[#34363a] bg-[#111113] text-white"
                      disabled={controlsDisabled}
                      onClick={() =>
                        void handleText("No, please do not call me again.")
                      }
                    >
                      Consent no
                    </Button>
                  </div>
                </div>
              ) : null}

              {call.status === "collecting" && currentField ? (
                <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-xs text-zinc-400">
                  Currently collecting:{" "}
                  <span className="text-zinc-100">{currentField.label}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}
          {note ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">
              <TimerIcon className="size-4" /> {note}
            </div>
          ) : null}

          {callActive ? (
            <form
              className="mt-4 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!answer.trim() || busy) return
                void handleText(answer)
              }}
            >
              <label className="text-xs text-zinc-500">
                Text fallback (types the customer&apos;s answer directly)
              </label>
              <Input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                className="border-[#27272a] bg-[#111113] text-white"
                placeholder="Type the customer's spoken answer…"
                disabled={controlsDisabled}
              />
              <Button
                type="submit"
                disabled={controlsDisabled || !answer.trim()}
              >
                <SendIcon className="size-4" /> Send typed answer
              </Button>
            </form>
          ) : null}
        </div>

        {/* ─── Quality audit ─── */}
        <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
          <h3 className="flex items-center gap-2 font-medium">
            <ShieldCheckIcon className="size-4" /> Quality audit
          </h3>
          {audit ? (
            <div className="mt-3 grid gap-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={qaBadge(audit.status)}>
                  {audit.status}
                </Badge>
                {typeof audit.confidence === "number" ? (
                  <span className="text-xs text-zinc-500">
                    {audit.confidence}%
                  </span>
                ) : null}
              </div>
              <p className="text-sm leading-6 text-zinc-300">
                {audit.aiSummary}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="border-[#34363a] bg-[#111113] text-white"
                asChild
              >
                <Link href={`/auditor/${audit.id}`}>
                  <ClipboardListIcon className="size-4" /> Open full audit
                </Link>
              </Button>
            </div>
          ) : (
            <div className="mt-3 grid gap-3 text-sm text-zinc-400">
              {!callActive && call.endedAt ? (
                auditFetching ? (
                  <p className="flex items-center gap-2">
                    <Loader2Icon className="size-4 animate-spin" /> Recording
                    the conversation and passing it to the auditor…
                  </p>
                ) : (
                  <>
                    <p>The conversation was too short for a full audit.</p>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          setAudit(await runCallAuditNow(call.id))
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : "Audit failed"
                          )
                        } finally {
                          setBusy(false)
                        }
                      }}
                    >
                      <ShieldCheckIcon className="size-4" /> Run audit again
                    </Button>
                  </>
                )
              ) : (
                <p>
                  The full conversation will be passed through the AI Quality
                  Auditor automatically when the call ends.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ─── Journey fields ─── */}
        <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
          <h3 className="font-medium">Journey fields</h3>
          <div className="mt-3 grid gap-2">
            {journey.fields.map((field) => (
              <div
                key={field.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm"
              >
                <div>
                  <div>{field.label}</div>
                  <div className="text-xs text-zinc-500">
                    {field.required ? "Required" : "Optional"}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    field.value
                      ? "border-emerald-500/40 text-emerald-300"
                      : "border-amber-500/40 text-amber-300"
                  }
                >
                  {field.value ?? "missing"}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Warm handoff ─── */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 font-medium text-amber-200">
            <AlertTriangleIcon className="size-4" /> Warm handoff
          </div>
          <p className="mt-2 text-sm text-amber-100/70">
            Approving hands the current context bundle to a human agent.
          </p>
          <div className="mt-3 grid gap-2">
            <Select
              value={handoffReason}
              onValueChange={(value) =>
                setHandoffReason(value as HandoffReason)
              }
              disabled={busy}
            >
              <SelectTrigger className="border-[#34363a] bg-[#111113] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    {reason.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-100"
              disabled={busy || !callActive}
              onClick={async () => {
                setBusy(true)
                try {
                  const result = await triggerHandoff(call.id, handoffReason)
                  if (result.audit) setAudit(result.audit)
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Failed to prepare handoff"
                  )
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
              <div className="font-medium text-amber-100">
                Context bundle ready
              </div>
              <div className="mt-1">Reason: {call.handoff.reason}</div>
              <div className="mt-1">Summary: {call.handoff.summary}</div>
              <div className="mt-1">
                Remaining: {call.handoff.remaining.join(", ") || "none"}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
