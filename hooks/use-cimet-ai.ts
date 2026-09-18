"use client"

import * as React from "react"

import { demoAudits, demoCalls, demoJourneys } from "@/lib/cimet-demo-data"
import type { AuditDecision, AuditRun, CallSession, EnergyJourney, HandoffReason, Utterance } from "@/lib/cimet-ai-types"

const STORAGE_KEY = "cimet-ai-demo-state"

type DemoState = {
  journeys: EnergyJourney[]
  calls: CallSession[]
  audits: AuditRun[]
}

function loadDemoState(): DemoState {
  if (typeof window === "undefined") {
    return { journeys: demoJourneys, calls: demoCalls, audits: demoAudits }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { journeys: demoJourneys, calls: demoCalls, audits: demoAudits }
    const parsed = JSON.parse(raw) as Partial<DemoState>
    return {
      journeys: parsed.journeys ?? demoJourneys,
      calls: parsed.calls ?? demoCalls,
      audits: parsed.audits ?? demoAudits,
    }
  } catch {
    return { journeys: demoJourneys, calls: demoCalls, audits: demoAudits }
  }
}

function nextId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function nextMissingField(journey: EnergyJourney) {
  return journey.fields.find((field) => field.required && !field.value) ?? null
}

function promptForField(label: string) {
  return `Thanks. I only need one more detail from where you left off: ${label.toLowerCase()}. What should I put down?`
}

function createUtterance(speaker: Utterance["speaker"], text: string, index: number): Utterance {
  const startMs = index * 4500
  return { id: nextId("utt"), speaker, text, startMs, endMs: startMs + Math.max(1800, text.length * 35) }
}

export function useCimetAi() {
  const hydratedRef = React.useRef(false)
  const [journeys, setJourneys] = React.useState<EnergyJourney[]>(demoJourneys)
  const [calls, setCalls] = React.useState<CallSession[]>(demoCalls)
  const [audits, setAudits] = React.useState<AuditRun[]>(demoAudits)

  React.useEffect(() => {
    const saved = loadDemoState()
    setJourneys(saved.journeys)
    setCalls(saved.calls)
    setAudits(saved.audits)
    hydratedRef.current = true
  }, [])

  React.useEffect(() => {
    if (!hydratedRef.current) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ journeys, calls, audits }))
  }, [journeys, calls, audits])

  const getJourney = React.useCallback(
    (journeyId: string) => journeys.find((journey) => journey.id === journeyId) ?? null,
    [journeys]
  )

  const getCall = React.useCallback(
    (callId: string) => calls.find((call) => call.id === callId) ?? null,
    [calls]
  )

  const getAudit = React.useCallback(
    (auditId: string) => audits.find((audit) => audit.id === auditId) ?? null,
    [audits]
  )

  const placeCall = React.useCallback((callId: string) => {
    setCalls((current) =>
      current.map((call) => {
        if (call.id !== callId) return call
        const first = createUtterance(
          "ai",
          "Hi, this is CIMET's virtual energy assistant. You recently started comparing energy plans and did not finish. This call is recorded for quality and compliance. Is it okay if I continue?",
          call.utterances.length
        )
        return { ...call, status: "consent", startedAt: new Date().toISOString(), utterances: [...call.utterances, first] }
      })
    )
  }, [])

  const recordConsent = React.useCallback((callId: string, accepted: boolean) => {
    setCalls((current) =>
      current.map((call) => {
        if (call.id !== callId) return call
        const customer = createUtterance("customer", accepted ? "Yes, that is okay." : "No, please do not call me again.", call.utterances.length)
        if (!accepted) {
          const close = createUtterance("ai", "No problem. Thank you for your time. I will end the call now.", call.utterances.length + 1)
          return { ...call, status: "declined", consentRecorded: false, endedAt: new Date().toISOString(), utterances: [...call.utterances, customer, close] }
        }
        const journey = journeys.find((item) => item.id === call.journeyId)
        const field = journey ? nextMissingField(journey) : null
        const ask = createUtterance("ai", field ? promptForField(field.label) : "Thanks. I have everything needed to submit the journey.", call.utterances.length + 1)
        return { ...call, status: field ? "collecting" : "completed", consentRecorded: true, currentQuestionKey: field?.key, utterances: [...call.utterances, customer, ask] }
      })
    )
  }, [journeys])

  const answerQuestion = React.useCallback((callId: string, value: string) => {
    let completedJourneyId: string | null = null

    setCalls((currentCalls) =>
      currentCalls.map((call) => {
        if (call.id !== callId || !call.currentQuestionKey) return call
        const customer = createUtterance("customer", value, call.utterances.length)
        let nextPrompt: Utterance | null = null
        let nextQuestionKey: string | undefined

        setJourneys((currentJourneys) =>
          currentJourneys.map((journey) => {
            if (journey.id !== call.journeyId) return journey
            const updatedFields = journey.fields.map((field) =>
              field.key === call.currentQuestionKey ? { ...field, value, collectedBy: "ai" as const } : field
            )
            const updatedJourney = { ...journey, status: "calling" as const, fields: updatedFields }
            const nextField = nextMissingField(updatedJourney)
            if (nextField) {
              nextQuestionKey = nextField.key
              nextPrompt = createUtterance("ai", promptForField(nextField.label), call.utterances.length + 1)
            } else {
              completedJourneyId = journey.id
              nextPrompt = createUtterance("ai", "That's everything I need. I will submit this energy journey now. Thanks for your time.", call.utterances.length + 1)
            }
            return nextField ? updatedJourney : { ...updatedJourney, status: "completed" as const }
          })
        )

        return {
          ...call,
          status: completedJourneyId === call.journeyId ? "completed" : "collecting",
          currentQuestionKey: nextQuestionKey,
          endedAt: completedJourneyId === call.journeyId ? new Date().toISOString() : call.endedAt,
          utterances: nextPrompt ? [...call.utterances, customer, nextPrompt] : [...call.utterances, customer],
        }
      })
    )
  }, [])

  const triggerHandoff = React.useCallback((callId: string, reason: HandoffReason) => {
    setCalls((current) =>
      current.map((call) => {
        if (call.id !== callId) return call
        const journey = journeys.find((item) => item.id === call.journeyId)
        const collected = journey?.fields.filter((field) => field.value).map((field) => ({ label: field.label, value: String(field.value) })) ?? []
        const remaining = journey?.fields.filter((field) => field.required && !field.value).map((field) => field.label) ?? []
        return {
          ...call,
          status: "handoff",
          safetyScore: Math.min(call.safetyScore, 44),
          handoff: {
            reason,
            collected,
            remaining,
            summary: "AI stopped and prepared a warm handoff so the customer does not repeat information already collected.",
          },
        }
      })
    )
  }, [journeys])

  const overrideAudit = React.useCallback((auditId: string, decision: AuditDecision, reason: string) => {
    setAudits((current) =>
      current.map((audit) =>
        audit.id === auditId
          ? { ...audit, status: decision, override: { auditor: "Team Lead", decision, reason } }
          : audit
      )
    )
  }, [])

  const dashboard = React.useMemo(() => {
    const total = audits.length
    const autoPass = audits.filter((audit) => audit.status === "auto-pass").length
    const hold = audits.filter((audit) => audit.status === "hold").length
    const review = audits.filter((audit) => audit.status === "human-review").length
    const criticalFailures = audits.flatMap((audit) => audit.checks).filter((check) => check.critical && check.verdict === "fail").length
    const agreement = Math.round(((total - audits.filter((audit) => audit.override).length) / Math.max(total, 1)) * 100)
    return { total, autoPass, hold, review, criticalFailures, agreement }
  }, [audits])

  return {
    journeys,
    calls,
    audits,
    dashboard,
    getJourney,
    getCall,
    getAudit,
    placeCall,
    recordConsent,
    answerQuestion,
    triggerHandoff,
    overrideAudit,
  }
}
