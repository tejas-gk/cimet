"use client"

import * as React from "react"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SolarMessageSpeaker = "user" | "ai" | "human-agent"

export type SolarMessage = {
  id: string
  speaker: SolarMessageSpeaker
  text: string
}

export type SolarHandoff = {
  reason: string
  summary: string
  collected: Array<{ label: string; value: string }>
}

export type SolarPhase = "idle" | "connected" | "handed-off"

type StartResult = {
  turn: { speaker: string; text: string; audioBase64: string | null }
}

type TurnResult = {
  transcript: string
  turns: Array<{
    speaker: "ai" | "human-agent"
    text: string
    audioBase64: string | null
  }>
  handoff: SolarHandoff | null
  needsHumanAgent: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = (await res.json().catch(() => null)) as {
    data: T
    error?: { message: string }
  } | null
  if (!res.ok) {
    throw new Error(payload?.error?.message ?? `Request failed (${res.status})`)
  }
  return (payload?.data ?? null) as T
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useSolarAgent() {
  const [phase, setPhase] = React.useState<SolarPhase>("idle")
  const [messages, setMessages] = React.useState<SolarMessage[]>([])
  const [handoff, setHandoff] = React.useState<SolarHandoff | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // ── Start ──────────────────────────────────────────────────────────────

  const start = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await api<StartResult>("/api/solar/start", {})
      const greeting: SolarMessage = {
        id: crypto.randomUUID(),
        speaker: "ai",
        text: result.turn.text,
      }
      setMessages([greeting])
      setPhase("connected")
      return result.turn
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start call")
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  // ── Submit a turn ──────────────────────────────────────────────────────

  const sendTurn = React.useCallback(
    async (input: {
      text?: string
      audioBase64?: string
    }): Promise<TurnResult | null> => {
      setBusy(true)
      setError(null)
      try {
        const history = messages.map((m) => ({
          speaker: m.speaker as SolarMessageSpeaker,
          text: m.text,
        }))

        const result = await api<TurnResult>("/api/solar/turn", {
          text: input.text,
          audioBase64: input.audioBase64,
          history,
          humanAgent: phase === "handed-off",
        })

        // Append the user's spoken / typed message.
        const userMsg: SolarMessage = {
          id: crypto.randomUUID(),
          speaker: "user",
          text: result.transcript || input.text || "(voice)",
        }
        setMessages((prev) => [...prev, userMsg])

        // Append all agent turns.
        for (const turn of result.turns) {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), speaker: turn.speaker, text: turn.text },
          ])
        }

        // Update phase.
        if (result.needsHumanAgent) setPhase("handed-off")
        if (result.handoff) setHandoff(result.handoff)

        return result
      } catch (err) {
        setError(err instanceof Error ? err.message : "Agent could not respond")
        return null
      } finally {
        setBusy(false)
      }
    },
    [messages, phase]
  )

  // ── Escalate (sends a synthetic message that forces handoff) ───────────

  const escalate = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const history = messages.map((m) => ({
        speaker: m.speaker as SolarMessageSpeaker,
        text: m.text,
      }))

      const result = await api<TurnResult>("/api/solar/turn", {
        text: "__ESCALATE__",
        history,
        humanAgent: false,
      })

      const userMsg: SolarMessage = {
        id: crypto.randomUUID(),
        speaker: "user",
        text: "I'd like to speak with a human, please.",
      }
      setMessages((prev) => [...prev, userMsg])

      for (const turn of result.turns) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), speaker: turn.speaker, text: turn.text },
        ])
      }

      setPhase("handed-off")
      if (result.handoff) setHandoff(result.handoff)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to escalate")
      return null
    } finally {
      setBusy(false)
    }
  }, [messages])

  // ── Reset ──────────────────────────────────────────────────────────────

  const reset = React.useCallback(() => {
    setPhase("idle")
    setMessages([])
    setHandoff(null)
    setError(null)
  }, [])

  return {
    phase,
    messages,
    handoff,
    busy,
    error,
    start,
    sendTurn,
    escalate,
    reset,
  }
}
