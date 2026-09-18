"use client"

import * as React from "react"

import type {
  AuditDecision,
  AuditRun,
  EnergyJourney,
  CallSession,
  HandoffReason,
} from "@/lib/cimet-ai-types"

export type TurnInput = {
  text?: string
  audioBase64?: string
}

export type VoiceTurnResult = {
  call: CallSession
  journey: EnergyJourney
  audioBase64: string | null
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
  const payload = (await response.json().catch(() => null)) as
    | { data: T; message?: string; error?: { message: string; code: string } }
    | null

  if (!response.ok) {
    const message = payload?.error?.message ?? `Request failed (${response.status})`
    throw new Error(message)
  }
  return (payload?.data ?? null) as T
}

export function useCimetAi() {
  const mountedRef = React.useRef(false)
  const [journeys, setJourneys] = React.useState<EnergyJourney[]>([])
  const [calls, setCalls] = React.useState<CallSession[]>([])
  const [audits, setAudits] = React.useState<AuditRun[]>([])
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
      const [journeyData, callData, auditData, dashboardData] = await Promise.all([
        api<EnergyJourney[]>("/api/journeys"),
        api<Array<CallSession & { journey: EnergyJourney | null }>>("/api/calls"),
        api<AuditRun[]>("/api/audits"),
        api<DashboardMetrics>("/api/dashboard"),
      ])
      setJourneys(journeyData)
      setCalls(callData)
      setAudits(auditData)
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
    async (callId: string, reason: HandoffReason) => {
      await api<CallSession>(`/api/calls/${callId}/handoff`, {
        method: "POST",
        body: { reason },
      })
      await refresh()
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
      const payload = (await response.json().catch(() => null)) as
        | { data?: AuditRun; error?: { message: string } }
        | null
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? `Upload failed (${response.status})`)
      }
      await refresh()
      return (payload?.data ?? null) as AuditRun
    },
    [refresh]
  )

  const generateDemo = React.useCallback(
    async (message: (msg: string) => void) => {
      const response = await fetch("/api/demo/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: "all" }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; error?: { message: string } }
        | null
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? `Demo generation failed (${response.status})`)
      }
      if (payload?.message) message(payload.message)
      await refresh()
    },
    [refresh]
  )

  return {
    journeys,
    calls,
    audits,
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
    overrideAudit,
    uploadAudit,
    generateDemo,
  }
}