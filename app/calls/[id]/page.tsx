"use client"

import { AlertTriangleIcon, CheckCircle2Icon, PhoneForwardedIcon, SendIcon } from "lucide-react"
import { useParams } from "next/navigation"
import * as React from "react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCimetAi } from "@/hooks/use-cimet-ai"
import type { HandoffReason } from "@/lib/cimet-ai-types"

const reasons: Array<{ value: HandoffReason; label: string }> = [
  { value: "asked-for-human", label: "Asked for human" },
  { value: "angry-customer", label: "Angry customer" },
  { value: "low-confidence", label: "Low confidence" },
  { value: "out-of-scope", label: "Out of scope" },
  { value: "sensitive-topic", label: "Sensitive topic" },
  { value: "repeated-misunderstanding", label: "Repeated misunderstanding" },
]

export default function CallDetailPage() {
  const params = useParams<{ id: string }>()
  const [answer, setAnswer] = React.useState("")
  const [handoffReason, setHandoffReason] = React.useState<HandoffReason>("asked-for-human")
  const { getCall, getJourney, placeCall, recordConsent, answerQuestion, triggerHandoff } = useCimetAi()
  const call = getCall(params.id)
  const journey = call ? getJourney(call.journeyId) : null
  const currentField = journey?.fields.find((field) => field.key === call?.currentQuestionKey)

  if (!call || !journey) {
    return (
      <CimetAiShell>
        <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-6">Call not found.</div>
      </CimetAiShell>
    )
  }

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
              <div className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm"><div className="text-zinc-500">Safety</div><div>{call.safetyScore}%</div></div>
            </div>
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c]">
            <div className="border-b border-[#27272a] p-4 font-medium">Conversation transcript</div>
            <div className="grid max-h-[520px] gap-3 overflow-y-auto p-4">
              {call.utterances.length === 0 ? <div className="text-sm text-zinc-500">No call activity yet. Start the simulated call.</div> : null}
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
            <h3 className="font-medium">Agent controls</h3>
            <div className="mt-3 grid gap-2">
              {call.status === "queued" ? <Button onClick={() => placeCall(call.id)}>Start outbound call</Button> : null}
              {call.status === "consent" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => recordConsent(call.id, true)}><CheckCircle2Icon className="size-4" /> Consent yes</Button>
                  <Button variant="outline" className="border-[#34363a] bg-[#111113] text-white" onClick={() => recordConsent(call.id, false)}>Consent no</Button>
                </div>
              ) : null}
              {call.status === "collecting" && currentField ? (
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!answer.trim()) return
                    answerQuestion(call.id, answer.trim())
                    setAnswer("")
                  }}
                >
                  <label className="text-xs text-zinc-500">Customer answer for {currentField.label}</label>
                  <Input value={answer} onChange={(event) => setAnswer(event.target.value)} className="border-[#27272a] bg-[#111113] text-white" placeholder="Type natural answer..." />
                  <Button type="submit"><SendIcon className="size-4" /> Save answer</Button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
            <h3 className="font-medium">Missing fields</h3>
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
            <p className="mt-2 text-sm text-amber-100/70">Trigger when the customer asks for a person, becomes angry, is out-of-scope, or AI confidence drops.</p>
            <div className="mt-3 grid gap-2">
              <Select value={handoffReason} onValueChange={(value) => setHandoffReason(value as HandoffReason)}>
                <SelectTrigger className="border-[#34363a] bg-[#111113] text-white"><SelectValue /></SelectTrigger>
                <SelectContent>{reasons.map((reason) => <SelectItem key={reason.value} value={reason.value}>{reason.label}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-100" onClick={() => triggerHandoff(call.id, handoffReason)}>
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
