"use client"

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  Loader2Icon,
  PauseCircleIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCimetAi } from "@/hooks/use-cimet-ai"

function decisionClass(status: string) {
  if (status === "auto-pass") return "border-emerald-500/40 text-emerald-300"
  if (status === "hold") return "border-red-500/40 text-red-300"
  return "border-amber-500/40 text-amber-300"
}

function decisionIcon(status: string) {
  if (status === "auto-pass") return <CheckCircle2Icon className="size-4" />
  if (status === "hold") return <PauseCircleIcon className="size-4" />
  return <SearchIcon className="size-4" />
}

export default function AuditorPage() {
  const { audits, dashboard, uploadAudit } = useCimetAi()
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [retailer, setRetailer] = React.useState("EnergyAustralia")
  const [agentName, setAgentName] = React.useState("")
  const [leadName, setLeadName] = React.useState("")
  const [customerEmail, setCustomerEmail] = React.useState("")

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const form = new FormData()
    form.append("file", file)
    form.append("retailer", retailer)
    form.append("agentName", agentName)
    form.append("leadName", leadName)
    if (customerEmail.trim()) form.append("customerEmail", customerEmail.trim())
    try {
      const audit = await uploadAudit(form)
      setNotice(
        `Audit ${audit.id} completed: ${audit.status} (${audit.confidence}% confidence).`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="grid gap-2">
          <Badge
            variant="outline"
            className="w-fit border-violet-500/30 bg-violet-500/10 text-violet-200"
          >
            Project 2 · AI Quality Auditor
          </Badge>
          <h2 className="text-2xl font-semibold tracking-tight">
            Completed-call audits
          </h2>
          <p className="max-w-3xl text-sm text-zinc-400">
            Real recordings are transcribed by Sarvam STT, speaker-attributed,
            then checked against script, CRM and retailer rules by the LLM
            before routing to auto-pass, hold or human review.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Total audits" value={dashboard.total} />
          <Metric label="Auto-pass" value={dashboard.autoPass} />
          <Metric label="Critical holds" value={dashboard.hold} />
          <Metric label="Human reviews" value={dashboard.review} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <form
            onSubmit={handleUpload}
            className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4"
          >
            <h3 className="font-medium">Audit a real recording</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Short WAV/MP3 of an actual call (synchronous STT handles under
              30s).
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-zinc-500">
                Audio file
                <input
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.ogg"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="rounded-lg border border-[#27272a] bg-[#111113] p-2 text-xs text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-white file:text-black"
                />
              </label>
              <label className="grid gap-1 text-xs text-zinc-500">
                Lead name
                <Input
                  value={leadName}
                  onChange={(event) => setLeadName(event.target.value)}
                  required
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </label>
              <label className="grid gap-1 text-xs text-zinc-500">
                Agent name
                <Input
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  required
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </label>
              <label className="grid gap-1 text-xs text-zinc-500">
                Retailer
                <select
                  value={retailer}
                  onChange={(event) => setRetailer(event.target.value)}
                  className="rounded-md border border-[#27272a] bg-[#111113] px-3 py-1.5 text-sm text-white"
                >
                  <option>EnergyAustralia</option>
                  <option>AGL</option>
                  <option>Origin</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-zinc-500 md:col-span-2">
                Customer email on file (optional — enables the CRM email check)
                <Input
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  placeholder="alice@acme.com"
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </label>
            </div>
            <Button type="submit" className="mt-3" disabled={busy || !file}>
              {busy ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <UploadIcon className="size-4" />
              )}{" "}
              Run audit pipeline
            </Button>
          </form>

          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
            <h3 className="font-medium">Post-call review queue</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Completed voice-agent calls are stored in SQLite, assembled into
              recordings, audited, then fetched here from the database for human
              review.
            </p>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            {notice}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-[#27272a] bg-[#0b0b0c]">
          {audits.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">
              No audits yet. Upload a recording or complete a voice-agent call.
            </div>
          ) : null}
          {audits.map((audit) => {
            const failures = audit.checks.filter(
              (check) => check.verdict === "fail"
            ).length
            return (
              <div
                key={audit.id}
                className="grid gap-3 border-b border-[#202023] p-4 last:border-b-0 lg:grid-cols-[1.2fr_1fr_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-zinc-100">
                      {audit.leadName}
                    </h3>
                    <Badge
                      variant="outline"
                      className={decisionClass(audit.status)}
                    >
                      {decisionIcon(audit.status)} {audit.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-zinc-500">
                    Agent {audit.agentName} · {audit.retailer}
                  </div>
                  <div className="mt-2 text-xs text-zinc-400">
                    {audit.aiSummary}
                  </div>
                </div>
                <div className="grid gap-1 text-xs text-zinc-400">
                  <div>
                    Checks:{" "}
                    <span className="text-zinc-200">{audit.checks.length}</span>
                  </div>
                  <div>
                    Failures: <span className="text-zinc-200">{failures}</span>
                  </div>
                  <div>
                    Confidence:{" "}
                    <span className="text-zinc-200">{audit.confidence}%</span>
                  </div>
                </div>
                <div className="flex justify-start lg:justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[#34363a] bg-[#111113] text-white"
                    asChild
                  >
                    <Link href={`/auditor/${audit.id}`}>
                      <ClipboardCheckIcon className="size-4" /> Review{" "}
                      <ArrowRightIcon className="size-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </CimetAiShell>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  )
}
