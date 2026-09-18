"use client"

import { ArrowRightIcon, PhoneCallIcon } from "lucide-react"
import Link from "next/link"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useCimetAi } from "@/hooks/use-cimet-ai"

function statusTone(status: string) {
  if (status === "completed") return "border-emerald-500/40 text-emerald-300"
  if (status === "handoff") return "border-amber-500/40 text-amber-300"
  if (status === "declined") return "border-red-500/40 text-red-300"
  return "border-sky-500/40 text-sky-300"
}

export default function CallsPage() {
  const { calls, journeys, loading } = useCimetAi()

  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="grid gap-2">
          <Badge variant="outline" className="w-fit border-sky-500/30 bg-sky-500/10 text-sky-200">Project 1 · AI Voice Agent</Badge>
          <h2 className="text-2xl font-semibold tracking-tight">Dropped energy journeys</h2>
          <p className="max-w-3xl text-sm text-zinc-400">
            Real CRM journeys imported from your production environment. The agent uses live Sarvam TTS, STT and LLM for every turn.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
            <div className="text-2xl font-semibold">{calls.length}</div>
            <div className="text-xs text-zinc-500">active lead call sessions</div>
          </div>
          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
            <div className="text-2xl font-semibold">{journeys.filter((journey) => !journey.doNotCall).length}</div>
            <div className="text-xs text-zinc-500">DNC-cleared journeys</div>
          </div>
          <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
            <div className="text-2xl font-semibold">Sarvam</div>
            <div className="text-xs text-zinc-500">voice provider active</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#27272a] bg-[#0b0b0c]">
          {loading && calls.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">Loading journeys…</div>
          ) : null}
          {calls.map((call) => {
            const journey = journeys.find((item) => item.id === call.journeyId)
            const missing = journey?.fields.filter((field) => field.required && !field.value).length ?? 0
            return (
              <div key={call.id} className="grid gap-3 border-b border-[#202023] p-4 last:border-b-0 lg:grid-cols-[1.4fr_1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-zinc-100">{journey?.customerName}</h3>
                    <Badge variant="outline" className={statusTone(call.status)}>{call.status}</Badge>
                    {call.handoff ? <Badge variant="outline" className="border-amber-500/40 text-amber-300">handoff ready</Badge> : null}
                  </div>
                  <div className="mt-1 text-sm text-zinc-500">{journey?.phone} · {journey?.email}</div>
                  <div className="mt-2 text-xs text-zinc-400">Stopped at <span className="text-zinc-200">{journey?.abandonStep}</span>; {missing} required fields missing.</div>
                </div>
                <div className="grid gap-1 text-xs text-zinc-400">
                  <div>Retailer: <span className="text-zinc-200">{journey?.retailer}</span></div>
                  <div>State: <span className="text-zinc-200">{journey?.state}</span></div>
                  <div>Safety: <span className="text-zinc-200">{call.safetyScore}%</span></div>
                </div>
                <div className="flex gap-2 lg:justify-end">
                  <Button size="sm" variant="outline" className="border-[#34363a] bg-[#111113] text-white" asChild>
                    <Link href={`/calls/${call.id}`}>Open voice agent <ArrowRightIcon className="size-4" /></Link>
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