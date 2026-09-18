"use client"

import { ArrowLeftIcon, PhoneCallIcon, ShieldCheckIcon } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import * as React from "react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { QualityAuditDetail } from "@/components/quality-audit-detail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { VoiceAgentDetail } from "@/components/voice-agent-detail"
import { useCimetAi } from "@/hooks/use-cimet-ai"
import { useLeads } from "@/hooks/use-leads"

function shortId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12)
}

function statusBadge(status: string) {
  if (status === "queued" || status === "ringing")
    return "border-sky-500/40 text-sky-300"
  if (status === "consent" || status === "collecting")
    return "border-amber-500/40 text-amber-300"
  if (status === "completed") return "border-emerald-500/40 text-emerald-300"
  if (status === "declined") return "border-red-500/40 text-red-300"
  return "border-[#34363a] text-zinc-400"
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const { getLead } = useLeads()
  const { journeys, calls, audits, refresh } = useCimetAi()
  const [activeCallId, setActiveCallId] = React.useState<string | null>(null)

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const lead = getLead(params.id)
  const journeyId = `journey-lead-${shortId(params.id)}`
  const journey = journeys.find((journey) => journey.id === journeyId) ?? null
  const history = journey
    ? calls.filter((call) => call.journeyId === journey.id)
    : []
  const activeCall =
    history.find((call) => call.id === activeCallId) ?? history[0] ?? null
  const activeAudit = activeCall
    ? (audits.find((audit) => audit.leadId === activeCall.id) ?? null)
    : null

  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              >
                Lead detail
              </Badge>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {lead?.name || "Lead"}
            </h2>
            <div className="mt-1 text-sm text-zinc-400">
              {lead?.phone || "—"} · {lead?.email || "—"} ·{" "}
              {lead?.company || "No company"}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-[#34363a] bg-[#111113] text-white"
            asChild
          >
            <Link href="/leads">
              <ArrowLeftIcon className="size-4" /> Back to leads
            </Link>
          </Button>
        </div>

        {!journey ? (
          <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c] p-10 text-center">
            <div className="text-sm text-zinc-400">
              No calls yet for this lead. Use &ldquo;Call by phone&rdquo; on the
              leads list to start one — the finished call is audited
              automatically and appears here.
            </div>
            <Button size="sm" className="mt-4" asChild>
              <Link href="/leads">
                <PhoneCallIcon className="size-4" /> Back to leads
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
              <div className="mb-3 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                Call history ({history.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {history.length === 0 ? (
                  <span className="text-sm text-zinc-500">
                    No calls recorded yet.
                  </span>
                ) : (
                  history.map((call) => (
                    <button
                      key={call.id}
                      type="button"
                      onClick={() => setActiveCallId(call.id)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        activeCall?.id === call.id
                          ? "border-sky-500/50 bg-sky-500/10 text-sky-100"
                          : "border-[#34363a] bg-[#111113] text-zinc-300 hover:border-sky-500/40"
                      }`}
                    >
                      <span className="truncate font-mono text-xs">
                        {call.id}
                      </span>
                      <Badge
                        variant="outline"
                        className={statusBadge(call.status)}
                      >
                        {call.status}
                      </Badge>
                      <span className="text-xs text-zinc-500">
                        {call.provider}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {activeCall ? (
              <VoiceAgentDetail key={activeCall.id} callId={activeCall.id} />
            ) : null}

            <div className="grid gap-5">
              <div className="flex items-center gap-2">
                <h3 className="flex items-center gap-2 font-medium">
                  <ShieldCheckIcon className="size-4" /> Quality audit
                </h3>
              </div>
              {activeAudit ? (
                <QualityAuditDetail
                  key={activeAudit.id}
                  auditId={activeAudit.id}
                />
              ) : (
                <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c] p-8 text-sm text-zinc-400">
                  No audit yet for the selected call. The full conversation is
                  passed through the AI Quality Auditor as soon as the call
                  ends.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </CimetAiShell>
  )
}
