"use client"

import {
  CheckCircle2Icon,
  ClockIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
  XCircleIcon,
} from "lucide-react"
import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useCimetAi } from "@/hooks/use-cimet-ai"
import type { AuditDecision, AuditVerdict } from "@/lib/cimet-ai-types"
import { formatMs } from "@/lib/format"

function verdictStyle(verdict: AuditVerdict) {
  if (verdict === "pass") return "border-emerald-500/40 text-emerald-300"
  if (verdict === "fail") return "border-red-500/40 text-red-300"
  return "border-amber-500/40 text-amber-300"
}

export function QualityAuditDetail({ auditId }: { auditId: string }) {
  const { getAudit, overrideAudit } = useCimetAi()
  const audit = getAudit(auditId)
  const [decision, setDecision] = React.useState<AuditDecision>("human-review")
  const [reason, setReason] = React.useState(
    "Reviewed manually and confirmed outcome."
  )
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  if (!audit) {
    return (
      <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-6">
        Audit not found.
      </div>
    )
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="grid content-start gap-5">
        <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-5">
          <Badge
            variant="outline"
            className="mb-2 border-violet-500/30 bg-violet-500/10 text-violet-200"
          >
            QA audit
          </Badge>
          <h2 className="text-2xl font-semibold">{audit.leadName}</h2>
          <div className="mt-1 text-sm text-zinc-400">
            {audit.agentName} · {audit.retailer}
          </div>
          <div className="mt-4 rounded-lg border border-[#242427] bg-[#111113] p-3 text-sm text-zinc-300">
            {audit.aiSummary}
          </div>
          {audit.recordingUrl ? (
            <audio
              controls
              preload="metadata"
              src={audit.recordingUrl}
              className="mt-4 w-full"
            />
          ) : null}
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-[#242427] bg-[#111113] p-3">
              <div className="text-zinc-500">Decision</div>
              <div>{audit.status}</div>
            </div>
            <div className="rounded-lg border border-[#242427] bg-[#111113] p-3">
              <div className="text-zinc-500">Confidence</div>
              <div>{audit.confidence}%</div>
            </div>
            <div className="rounded-lg border border-[#242427] bg-[#111113] p-3">
              <div className="text-zinc-500">Checks</div>
              <div>{audit.checks.length}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c]">
          <div className="border-b border-[#27272a] p-4 font-medium">
            Diarized transcript
          </div>
          <div className="grid max-h-[580px] gap-3 overflow-y-auto p-4">
            {audit.transcript.map((utterance) => (
              <button
                key={utterance.id}
                type="button"
                className="rounded-lg border border-[#242427] bg-[#111113] p-3 text-left transition-colors hover:border-sky-500/40 hover:bg-sky-500/10"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                  <ClockIcon className="size-3" /> {formatMs(utterance.startMs)}{" "}
                  · {utterance.speaker}
                </div>
                <div className="text-sm leading-6 text-zinc-100">
                  {utterance.text}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid content-start gap-5">
        <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c]">
          <div className="border-b border-[#27272a] p-4 font-medium">
            Checklist evidence
          </div>
          <div className="grid gap-3 p-4">
            {audit.checks.map((check) => (
              <div
                key={check.id}
                className="rounded-xl border border-[#242427] bg-[#111113] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-zinc-100">
                      {check.label}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {check.type} · {check.critical ? "critical" : "coaching"}{" "}
                      · {check.confidence}% confidence
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={verdictStyle(check.verdict)}
                  >
                    {check.verdict === "pass" ? (
                      <CheckCircle2Icon className="size-3" />
                    ) : check.verdict === "fail" ? (
                      <XCircleIcon className="size-3" />
                    ) : (
                      <RotateCcwIcon className="size-3" />
                    )}{" "}
                    {check.verdict}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-zinc-300">{check.finding}</p>
                <div className="mt-3 grid gap-2">
                  {check.evidence.map((evidence) => (
                    <div
                      key={`${check.id}-${evidence.utteranceId}`}
                      className="rounded-lg border border-[#2b2b30] bg-[#0b0b0c] p-3 text-sm"
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
                        <ExternalLinkIcon className="size-3" />{" "}
                        {formatMs(evidence.startMs)} -{" "}
                        {formatMs(evidence.endMs)}
                      </div>
                      <div className="text-zinc-200">“{evidence.quote}”</div>
                      {evidence.correctValue ? (
                        <div className="mt-2 text-xs text-emerald-300">
                          Correct value: {evidence.correctValue}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
          <h3 className="font-medium">Human override</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Disagreement is stored so CIMET can measure AI-vs-human QA
            agreement.
          </p>
          <div className="mt-3 grid gap-2">
            <Select
              value={decision}
              onValueChange={(value) => setDecision(value as AuditDecision)}
            >
              <SelectTrigger className="border-[#34363a] bg-[#111113] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto-pass">Auto-pass</SelectItem>
                <SelectItem value="hold">Hold</SelectItem>
                <SelectItem value="human-review">Human review</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 border-[#27272a] bg-[#111113] text-white"
            />
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setNotice(null)
                try {
                  await overrideAudit(audit.id, decision, reason)
                  setNotice("Override recorded.")
                } catch (err) {
                  setNotice(
                    err instanceof Error ? err.message : "Override failed"
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Record override
            </Button>
          </div>
          {notice ? (
            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              {notice}
            </div>
          ) : null}
          {audit.override ? (
            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              Override by {audit.override.auditor}: {audit.override.decision} —{" "}
              {audit.override.reason}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
