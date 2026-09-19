"use client"

import * as React from "react"

import {
  emptyLead,
  LEADS_CHANGED_EVENT,
  leadProgress,
  loadLeads,
  saveLeads,
  type Lead,
} from "@/lib/leads-store"

export function useLeads() {
  const [leads, setLeads] = React.useState<Lead[]>(() => loadLeads())
  const leadsRef = React.useRef(leads)

  React.useEffect(() => {
    leadsRef.current = leads
  }, [leads])

  React.useEffect(() => {
    const sync = () => {
      const next = loadLeads()
      leadsRef.current = next
      setLeads(next)
    }
    window.addEventListener(LEADS_CHANGED_EVENT, sync)
    window.addEventListener("storage", sync)
    return () => {
      window.removeEventListener(LEADS_CHANGED_EVENT, sync)
      window.removeEventListener("storage", sync)
    }
  }, [])

  const getLead = React.useCallback((id: string) => {
    return leadsRef.current.find((lead) => lead.id === id) ?? null
  }, [])

  const latestDraft = React.useMemo(
    () =>
      leads
        .filter((lead) => !lead.submitted)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
    [leads]
  )

  const upsertDraft = React.useCallback(
    (patch: Partial<Lead> & { id: string }) => {
      const now = Date.now()
      const current = leadsRef.current
      const existing = current.find((lead) => lead.id === patch.id)
      const draft: Lead = {
        ...(existing ?? emptyLead()),
        ...patch,
        updatedAt: now,
      }
      const next = existing
        ? current.map((lead) => (lead.id === patch.id ? draft : lead))
        : [...current, draft]
      leadsRef.current = next
      setLeads(next)
      saveLeads(next)
    },
    []
  )

  const submitLead = React.useCallback((id: string) => {
    const current = leadsRef.current
    const next = current.map((lead) =>
      lead.id === id
        ? { ...lead, submitted: true, updatedAt: Date.now() }
        : lead
    )
    leadsRef.current = next
    setLeads(next)
    saveLeads(next)
  }, [])

  return { leads, getLead, latestDraft, upsertDraft, submitLead, leadProgress }
}
