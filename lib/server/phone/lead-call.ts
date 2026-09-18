import type { DatabaseSync } from "node:sqlite"

import { createCall, createJourneyWithCall } from "@/lib/server/db"

export type LeadDialFacts = {
  id: string
  name: string
  phone: string
  email: string
  retailer: string
  state: string
  address: string
  postcode: string
  dob: string
  fuelType: string
  nmiMirn: string
  concession: string
  lifeSupport: string
  moveInDate: string
}

const KNOWN_RETAILERS = ["EnergyAustralia", "AGL", "Origin"]

function shortId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12)
}

export function createLeadCall(db: DatabaseSync, lead: LeadDialFacts) {
  const suffix = shortId(lead.id)
  const journeyId = `journey-lead-${suffix}`

  const existingJourney = db
    .prepare("SELECT id FROM journeys WHERE id = ?")
    .get(journeyId)

  const callId = existingJourney
    ? `call-lead-${suffix}-${Date.now().toString(36)}`
    : `call-lead-${suffix}`

  if (existingJourney) {
    createCall(db, {
      id: callId,
      journeyId,
      status: "queued",
      provider: "sarvam",
    })
  } else {
    createJourneyWithCall(db, {
      id: journeyId,
      customerName: lead.name || "Lead",
      phone: lead.phone,
      email: lead.email,
      retailer: KNOWN_RETAILERS.includes(lead.retailer)
        ? lead.retailer
        : KNOWN_RETAILERS[0],
      state: lead.state || "NSW",
      abandonStep: "Lead captured via the form",
      fields: [
        {
          key: "postcode",
          label: "Postcode",
          value: lead.postcode || null,
          required: true,
        },
        {
          key: "moveInDate",
          label: "Move-in date",
          value: lead.moveInDate || null,
          required: true,
        },
        {
          key: "concession",
          label: "Concession card",
          value: lead.concession || null,
          required: false,
        },
        {
          key: "lifeSupport",
          label: "Life support equipment",
          value: lead.lifeSupport || null,
          required: false,
        },
        {
          key: "fuelType",
          label: "Fuel type",
          value: lead.fuelType || null,
          required: false,
        },
      ],
      callId,
    })
  }

  return { journeyId, callId }
}
