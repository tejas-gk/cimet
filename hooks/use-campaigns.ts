"use client"

import * as React from "react"

import type { CampaignDetail, CampaignSummary, PageMeta } from "@/lib/api-types"

const emptyMeta: PageMeta = { total: 0, page: 1, limit: 20, pages: 1 }

let sequence = 0

function localId(prefix: string) {
  sequence += 1
  return `${prefix}_${Date.now().toString(36)}_${sequence}`
}

function buildCampaign(
  id: string,
  name: string,
  active: boolean,
  replyRate: string,
  queueLength: number,
  sendIntervalMin = 15
): CampaignSummary {
  const statuses = ["pending", "sent", "sent", "failed", "sending"]
  return {
    id,
    name,
    active,
    replyRate,
    sendIntervalMin,
    sequences: [
      { id: `${id}_seq_1`, subject: `${name} · intro`, body: "Quick question" },
    ],
    queue: Array.from({ length: queueLength }, (_, index) => ({
      status: statuses[index % statuses.length] ?? "pending",
    })),
  }
}

const initialCampaigns: CampaignSummary[] = [
  buildCampaign(
    "campaign_1",
    "Cold Outreach · SaaS Prospects",
    true,
    "12.4%",
    18
  ),
  buildCampaign("campaign_2", "Follow-ups · Q3 List", false, "8.1%", 6),
  buildCampaign("campaign_3", "Partnerships · Warm Intro", true, "21.0%", 12),
]

export function useCampaigns(limit = 20) {
  const [campaigns, setCampaigns] =
    React.useState<CampaignSummary[]>(initialCampaigns)
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const meta: PageMeta = React.useMemo(
    () => ({
      total: campaigns.length,
      page,
      limit,
      pages: Math.max(1, Math.ceil(campaigns.length / limit)),
    }),
    [campaigns.length, limit, page]
  )

  async function refresh() {
    setError(null)
    setLoading(false)
  }

  async function createCampaign(name: string, sendIntervalMin = 15) {
    const summary = buildCampaign(
      localId("campaign"),
      name,
      true,
      "0%",
      0,
      sendIntervalMin
    )
    setCampaigns((current) => [summary, ...current])
    return {
      ...summary,
      queue: { data: [], meta: emptyMeta },
    } as CampaignDetail
  }

  return {
    campaigns,
    meta,
    page,
    setPage,
    loading,
    error,
    refresh,
    createCampaign,
  }
}
