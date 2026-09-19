"use client"

import * as React from "react"

import type {
  AuditDecision,
  AuditRun,
  EnergyJourney,
  CallSession,
  HandoffQueueItem,
  HandoffReason,
  HumanAgent,
  HumanAgentStatus,
  HumanTurnResult,
} from "@/lib/cimet-ai-types"
import type { PhoneProviderId } from "@/lib/server/phone/types"

export type TurnInput = {
  text?: string
  audioBase64?: string
}

export type VoiceTurnResult = {
  call: CallSession
  journey: EnergyJourney
  audioBase64: string | null
  audit?: AuditRun | null
}

export type PhoneDialResult = {
  provider: PhoneProviderId
  providerCallId: string
  call: CallSession
}

type DashboardMetrics = {
  total: number
  autoPass: number
  hold: number
  review: number
  criticalFailures: number
  agreement: number
}

type FetchOptions = { method?: string; body?: unknown }

async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = (await response.json().catch(() => null)) as {
    data: T
    message?: string
    error?: { message: string; code: string }
  } | null

  if (!response.ok) {
    const message =
      payload?.error?.message ?? `Request failed (${response.status})`
    throw new Error(message)
  }
  return (payload?.data ?? null) as T
}

export function useCimetAi() {
  const mountedRef = React.useRef(false)
  const [journeys, setJourneys] = React.useState<EnergyJourney[]>([])
  const [calls, setCalls] = React.useState<CallSession[]>([])
  const [audits, setAudits] = React.useState<AuditRun[]>([])
  const [queue, setQueue] = React.useState<HandoffQueueItem[]>([])
  const [agents, setAgents] = React.useState<HumanAgent[]>([])
  const [dashboard, setDashboard] = React.useState<DashboardMetrics>({
    total: 0,
    autoPass: 0,
    hold: 0,
    review: 0,
    criticalFailures: 0,
    agreement: 0,
  })
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      const [journeyData, callData, auditData, queueData, agentData, dashboardData] =
        await Promise.all([
          api<EnergyJourney[]>("/api/journeys"),
          api<Array<CallSession & { journey: EnergyJourney | null }>>(
            "/api/calls"
          ),
          api<AuditRun[]>("/api/audits"),
          api<HandoffQueueItem[]>("/api/handoffs"),
          api<HumanAgent[]>("/api/agents"),
          api<DashboardMetrics>("/api/dashboard"),
        ])
      setJourneys(journeyData)
      setCalls(callData)
      setAudits(auditData)
      setQueue(queueData)
      setAgents(agentData)
      setDashboard(dashboardData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data")
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    void refresh()
  }, [refresh])

  const getJourney = React.useCallback(
    (journeyId: string) => journeys.find((j) => j.id === journeyId) ?? null,
    [journeys]
  )

  const getCall = React.useCallback(
    (callId: string) => calls.find((c) => c.id === callId) ?? null,
    [calls]
  )

  const getAudit = React.useCallback(
    (auditId: string) => audits.find((a) => a.id === auditId) ?? null,
    [audits]
  )

  const startCall = React.useCallback(
    async (callId: string): Promise<VoiceTurnResult> => {
      const result = await api<VoiceTurnResult>(`/api/calls/${callId}/start`, {
        method: "POST",
        body: {},
      })
      await refresh()
      return result
    },
    [refresh]
  )

  const sendTurn = React.useCallback(
    async (callId: string, input: TurnInput): Promise<VoiceTurnResult> => {
      const result = await api<VoiceTurnResult>(`/api/calls/${callId}/turn`, {
        method: "POST",
        body: input,
      })
      await refresh()
      return result
    },
    [refresh]
  )

  const triggerHandoff = React.useCallback(
    async (
      callId: string,
      reason: HandoffReason
    ): Promise<{
      call: CallSession
      audit: AuditRun | null
      audioBase64: string | null
    }> => {
      const result = await api<{
        call: CallSession
        audit: AuditRun | null
        audioBase64: string | null
      }>(`/api/calls/${callId}/handoff`, {
        method: "POST",
        body: { reason },
      })
      await refresh()
      return result
    },
    [refresh]
  )

  const answerHandoff = React.useCallback(
    async (callId: string, agentId: string) => {
      await api(`/api/handoffs/${callId}`, {
        method: "POST",
        body: { action: "accept", agentId },
      })
      await refresh()
    },
    [refresh]
  )

  const completeHandoff = React.useCallback(
    async (callId: string) => {
      await api(`/api/handoffs/${callId}`, {
        method: "POST",
        body: { action: "complete" },
      })
      await refresh()
    },
    [refresh]
  )

  const releaseHandoff = React.useCallback(
    async (callId: string) => {
      await api(`/api/handoffs/${callId}`, {
        method: "POST",
        body: { action: "release" },
      })
      await refresh()
    },
    [refresh]
  )

  const convertToCallback = React.useCallback(
    async (callId: string) => {
      await api(`/api/handoffs/${callId}`, {
        method: "POST",
        body: { action: "callback" },
      })
      await refresh()
    },
    [refresh]
  )

  const setAgentStatus = React.useCallback(
    async (agentId: string, status: HumanAgentStatus) => {
      await api(`/api/agents`, {
        method: "PATCH",
        body: { id: agentId, status },
      })
      await refresh()
    },
    [refresh]
  )

  const sendHumanTurn = React.useCallback(
    async (callId: string, input: TurnInput): Promise<HumanTurnResult> => {
      const result = await api<HumanTurnResult>(
        `/api/calls/${callId}/human-turn`,
        {
          method: "POST",
          body: input,
        }
      )
      await refresh()
      return result
    },
    [refresh]
  )

  /** Gracefully end an active call after a long customer pause. */
  const endCallSilently = React.useCallback(
    async (
      callId: string
    ): Promise<{ call: CallSession; audit: AuditRun | null }> => {
      const result = await api<{ call: CallSession; audit: AuditRun | null }>(
        `/api/calls/${callId}/end`,
        {
          method: "POST",
          body: {},
        }
      )
      await refresh()
      return result
    },
    [refresh]
  )

  /** Fetch the quality audit already produced for a finished call (null if none yet). */
  const fetchCallAudit = React.useCallback(
    async (callId: string): Promise<AuditRun | null> => {
      try {
        return await api<AuditRun>(`/api/calls/${callId}/audit`)
      } catch {
        return null
      }
    },
    []
  )

  /** Run the full conversation through the AI Quality Auditor right now. */
  const runCallAuditNow = React.useCallback(
    async (callId: string): Promise<AuditRun | null> => {
      const audit = await api<AuditRun>(`/api/calls/${callId}/audit`, {
        method: "POST",
        body: {},
      })
      await refresh()
      return audit
    },
    [refresh]
  )

  const dialPhoneCall = React.useCallback(
    async (
      callId: string,
      provider: PhoneProviderId
    ): Promise<PhoneDialResult> => {
      const result = await api<PhoneDialResult>(`/api/calls/${callId}/phone`, {
        method: "POST",
        body: { provider },
      })
      await refresh()
      return result
    },
    [refresh]
  )

  const overrideAudit = React.useCallback(
    async (auditId: string, decision: AuditDecision, reason: string) => {
      await api<AuditRun>(`/api/audits/${auditId}/override`, {
        method: "POST",
        body: { verdict: decision, note: reason },
      })
      await refresh()
    },
    [refresh]
  )

  const uploadAudit = React.useCallback(
    async (form: FormData): Promise<AuditRun> => {
      const response = await fetch("/api/audits/upload", {
        method: "POST",
        body: form,
      })
      const payload = (await response.json().catch(() => null)) as {
        data?: AuditRun
        error?: { message: string }
      } | null
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? `Upload failed (${response.status})`
        )
      }
      await refresh()
      return (payload?.data ?? null) as AuditRun
    },
    [refresh]
  )

  return {
    journeys,
    calls,
    audits,
    queue,
    agents,
    dashboard,
    loading,
    refreshing,
    error,
    refresh,
    getJourney,
    getCall,
    getAudit,
    startCall,
    sendTurn,
    triggerHandoff,
    answerHandoff,
    completeHandoff,
    releaseHandoff,
    convertToCallback,
    setAgentStatus,
    sendHumanTurn,
    endCallSilently,
    fetchCallAudit,
    runCallAuditNow,
    dialPhoneCall,
    overrideAudit,
    uploadAudit,
  }
}
