"use client"

import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  HeadsetIcon,
  Loader2Icon,
  PhoneCallIcon,
  RefreshCwIcon,
  UserRoundIcon,
} from "lucide-react"
import Link from "next/link"
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
import { useCimetAi } from "@/hooks/use-cimet-ai"
import type {
  HandoffQueueItem,
  HumanAgent,
} from "@/lib/cimet-ai-types"

function severityTone(severity: HandoffQueueItem["handoff"]["severity"]) {
  if (severity === "life-support")
    return "border-red-500/40 bg-red-500/10 text-red-200"
  if (severity === "sensitive")
    return "border-amber-500/40 bg-amber-500/10 text-amber-200"
  return "border-sky-500/40 bg-sky-500/10 text-sky-200"
}

function agentTone(status: HumanAgent["status"]) {
  if (status === "busy") return "border-amber-500/40 text-amber-300"
  if (status === "away") return "border-zinc-500/40 text-zinc-400"
  return "border-emerald-500/40 text-emerald-300"
}

function statusLine(item: HandoffQueueItem) {
  const h = item.handoff
  switch (h.status) {
    case "accepted":
      return h.assignedAgent
        ? `In call — ${h.assignedAgent} is live`
        : "In call — live"
    case "assigned":
      return h.assignedAgent
        ? `Routed to ${h.assignedAgent}`
        : "Routed — awaiting an agent"
    case "waiting":
      return `In queue · position ${h.queuePosition ?? 1} · ~${h.etaMinutes ?? 3} min wait`
    case "callback":
      return h.etaMinutes
        ? `Callback scheduled — ~${h.etaMinutes} min`
        : "Callback scheduled"
    default:
      return h.status
  }
}

export function DispatchQueue() {
  const {
    refresh,
    queue,
    agents,
    answerHandoff,
    convertToCallback,
    setAgentStatus,
    getCall,
  } = useCimetAi()
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [agentByCall, setAgentByCall] = React.useState<Record<string, string>>(
    {}
  )

  const defaultAgent =
    agents.find((agent) => agent.status === "online")?.id ?? agents[0]?.id ?? ""

  React.useEffect(() => {
    const interval = setInterval(() => void refresh(), 5000)
    return () => clearInterval(interval)
  }, [refresh])

  const run = async (callId: string, fn: () => Promise<unknown>) => {
    setBusyId(callId)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#27272a] p-4">
        <div className="flex items-center gap-2">
          <HeadsetIcon className="size-4 text-sky-300" />
          <h3 className="font-medium">Human dispatch queue</h3>
          {queue.some((item) => item.callStatus === "handoff") ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              live
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-[#34363a] bg-[#111113] text-white"
          onClick={() => void refresh()}
        >
          <RefreshCwIcon className="size-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 p-4">
        {/* ── Agent presence ── */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs tracking-wide text-zinc-500 uppercase">
            <UserRoundIcon className="size-3.5" /> Agents with availability
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-lg border border-[#242427] bg-[#111113] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-100">
                      {agent.name}
                    </div>
                    <div className="text-xs text-zinc-500">{agent.role}</div>
                  </div>
                  <Badge
                    variant="outline"
                    className={agentTone(agent.status)}
                  >
                    {agent.status}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-500">
                    {agent.activeHandoffs}/{agent.maxConcurrent} calls
                  </span>
                  <button
                    type="button"
                    className="text-xs text-sky-300 hover:text-sky-100"
                    disabled={agent.status === "busy"}
                    onClick={() =>
                      void setAgentStatus(
                        agent.id,
                        agent.status === "away" ? "online" : "away"
                      )
                    }
                  >
                    {agent.status === "away" ? "Mark online" : "Mark away"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {/* ── Open handoffs ── */}
        {queue.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#2d2d31] p-6 text-center text-sm text-zinc-500">
            No open handoffs right now — new ones appear here when the AI
            escalates a call to a person.
          </div>
        ) : null}

        {queue.map((item) => {
          const call = getCall(item.callId)
          const h = item.handoff
          const pickedAgent =
            agentByCall[item.callId] ??
            h.assignedAgentId ??
            defaultAgent
          const inCall = h.status === "accepted"
          return (
            <div
              key={item.callId}
              className="rounded-lg border border-[#242427] bg-[#111113] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-zinc-100">
                  {item.customerName}
                </span>
                {item.retailer ? (
                  <span className="text-sm text-zinc-500">
                    {item.retailer} · {item.state}
                  </span>
                ) : null}
                <Badge variant="outline" className={severityTone(h.severity)}>
                  {h.severity}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    inCall
                      ? "border-emerald-500/40 text-emerald-300"
                      : "border-[#34363a] text-zinc-300"
                  }
                >
                  {h.status}
                </Badge>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                <span>
                  Reason: <span className="text-zinc-200">{h.reason}</span>
                </span>
                <span>{statusLine(item)}</span>
              </div>

              <p className="mt-2 text-sm leading-6 text-zinc-300">
                {h.summary}
              </p>

              {h.remaining.length > 0 ? (
                <div className="mt-2 text-xs text-zinc-400">
                  Still needed:{" "}
                  <span className="text-zinc-200">
                    {h.remaining.join(", ")}
                  </span>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!inCall ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={pickedAgent}
                        onValueChange={(value) =>
                          setAgentByCall((prev) => ({
                            ...prev,
                            [item.callId]: value,
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 w-[150px] border-[#34363a] bg-[#19191b] text-xs text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={busyId === item.callId || !pickedAgent}
                        onClick={() =>
                          void run(item.callId, () =>
                            answerHandoff(item.callId, pickedAgent)
                          )
                        }
                      >
                        {busyId === item.callId ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : (
                          <PhoneCallIcon className="size-3.5" />
                        )}
                        Answer live
                      </Button>
                    </div>

                    {h.status === "waiting" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[#34363a] bg-[#19191b] text-white"
                          disabled={busyId === item.callId}
                          onClick={() =>
                            void run(item.callId, () =>
                              convertToCallback(item.callId)
                            )
                          }
                        >
                          <CalendarClockIcon className="size-3.5" /> Schedule
                          callback
                        </Button>
                      </>
                    ) : null}
                  </>
                ) : null}

                <Button
                  size="sm"
                  variant="outline"
                  className="border-sky-500/40 bg-sky-500/10 text-sky-100"
                  asChild
                >
                  <Link href={`/calls/${item.callId}`}>
                    {inCall
                      ? `Open live call ${call?.status === "handoff" ? "" : ""}`
                      : "Open voice agent"}
                    <ArrowRightIcon className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          )
        })}

        {queue.some((item) => item.handoff.status === "assigned") ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <AlertTriangleIcon className="size-3.5" />
            Answered handoffs open in the live-call takeover panel. Only the
            assigned agent can take over that call.
          </div>
        ) : null}
      </div>
    </div>
  )
}