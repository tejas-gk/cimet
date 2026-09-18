"use client"

import { BarChart3Icon, BotIcon, CheckCircle2Icon, ShieldAlertIcon } from "lucide-react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { Badge } from "@/components/ui/badge"
import { useCimetAi } from "@/hooks/use-cimet-ai"

export default function DashboardPage() {
  const { audits, dashboard } = useCimetAi()
  const checkFailures = audits
    .flatMap((audit) => audit.checks.map((check) => ({ ...check, audit })))
    .filter((check) => check.verdict === "fail")

  const byRetailer = audits.reduce<Record<string, number>>((acc, audit) => {
    acc[audit.retailer] = (acc[audit.retailer] ?? 0) + (audit.status === "hold" ? 1 : 0)
    return acc
  }, {})

  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-7xl gap-5">
        <div>
          <Badge variant="outline" className="mb-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-200">Operations dashboard</Badge>
          <h2 className="text-2xl font-semibold tracking-tight">QA automation metrics</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">Shows the core business outcomes CIMET asked for: auto-pass rate, holds, reviews, common failures and AI/human agreement.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <Metric icon={<BotIcon className="size-4" />} label="Total audits" value={dashboard.total} />
          <Metric icon={<CheckCircle2Icon className="size-4" />} label="Auto-pass" value={dashboard.autoPass} />
          <Metric icon={<ShieldAlertIcon className="size-4" />} label="Held sales" value={dashboard.hold} />
          <Metric icon={<BarChart3Icon className="size-4" />} label="Human review" value={dashboard.review} />
          <Metric icon={<CheckCircle2Icon className="size-4" />} label="AI agreement" value={`${dashboard.agreement}%`} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border border-[#27272a] bg-[#0b0b0c]">
            <div className="border-b border-[#27272a] p-4 font-medium">Most common critical failures</div>
            <div className="grid gap-3 p-4">
              {checkFailures.length === 0 ? <div className="text-sm text-zinc-500">No critical failures.</div> : null}
              {checkFailures.map((check) => (
                <div key={`${check.audit.id}-${check.id}`} className="rounded-lg border border-[#242427] bg-[#111113] p-3">
                  <div className="font-medium text-zinc-100">{check.label}</div>
                  <div className="mt-1 text-sm text-zinc-400">{check.audit.agentName} · {check.audit.retailer}</div>
                  <div className="mt-2 text-xs text-red-300">{check.finding}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[#27272a] bg-[#0b0b0c]">
            <div className="border-b border-[#27272a] p-4 font-medium">Holds by retailer</div>
            <div className="grid gap-3 p-4">
              {Object.entries(byRetailer).map(([retailer, count]) => (
                <div key={retailer} className="rounded-lg border border-[#242427] bg-[#111113] p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-medium text-zinc-100">{retailer}</div>
                    <Badge variant="outline" className="border-red-500/40 text-red-300">{count} hold{count === 1 ? "" : "s"}</Badge>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-[#222226]">
                    <div className="h-2 rounded-full bg-red-400" style={{ width: `${Math.max(8, count * 35)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </CimetAiShell>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
      <div className="mb-3 flex size-8 items-center justify-center rounded-md bg-white text-black">{icon}</div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  )
}
