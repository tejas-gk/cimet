/**
 * Seeds the database with CRM journey records and their queued call sessions.
 *
 * These rows represent customers imported from the retailer/CRM system who
 * abandoned an energy-comparison journey — production input, not generated AI
 * output. AI output (voice transcripts, audits) is always produced by the real
 * pipelines and never seeded.
 */

import type { DatabaseSync } from "node:sqlite"

import { createCall, createHumanAgent } from "@/lib/server/db"

type SeedField = {
  key: string
  label: string
  value: string | null
  required: boolean
  collectedBy?: "customer" | "ai"
}

type SeedJourney = {
  id: string
  customerName: string
  phone: string
  email: string
  retailer: string
  state: string
  status: "dropped" | "calling"
  abandonStep: string
  doNotCall: boolean
  fields: SeedField[]
  callId: string
}

const SEED_JOURNEYS: SeedJourney[] = [
  {
    id: "journey-1001",
    customerName: "Alice Johnson",
    phone: "+61 412 555 010",
    email: "alice@acme.com",
    retailer: "EnergyAustralia",
    state: "NSW",
    status: "dropped",
    abandonStep: "Move-in details",
    doNotCall: false,
    fields: [
      {
        key: "postcode",
        label: "Postcode",
        value: "2000",
        required: true,
        collectedBy: "customer",
      },
      {
        key: "propertyType",
        label: "Property type",
        value: "Apartment",
        required: true,
        collectedBy: "customer",
      },
      { key: "moveInDate", label: "Move-in date", value: null, required: true },
      {
        key: "lifeSupport",
        label: "Life support equipment",
        value: null,
        required: true,
      },
      {
        key: "currentRetailer",
        label: "Current retailer",
        value: null,
        required: false,
      },
    ],
    callId: "call-1001",
  },
  {
    id: "journey-1002",
    customerName: "Bob Martinez",
    phone: "+61 421 555 013",
    email: "bob@globex.com",
    retailer: "AGL",
    state: "VIC",
    status: "dropped",
    abandonStep: "Usage estimate",
    doNotCall: false,
    fields: [
      {
        key: "postcode",
        label: "Postcode",
        value: "3000",
        required: true,
        collectedBy: "customer",
      },
      {
        key: "propertyType",
        label: "Property type",
        value: "House",
        required: true,
        collectedBy: "customer",
      },
      {
        key: "usage",
        label: "Estimated quarterly usage",
        value: null,
        required: true,
      },
      { key: "solar", label: "Solar installed", value: null, required: true },
    ],
    callId: "call-1002",
  },
  {
    id: "journey-1003",
    customerName: "Carol Nguyen",
    phone: "+61 430 555 019",
    email: "carol@initech.com",
    retailer: "Origin",
    state: "QLD",
    status: "dropped",
    abandonStep: "Plan confirmation",
    doNotCall: false,
    fields: [
      {
        key: "postcode",
        label: "Postcode",
        value: "4000",
        required: true,
        collectedBy: "customer",
      },
      {
        key: "moveInDate",
        label: "Move-in date",
        value: "22 Sep 2026",
        required: true,
        collectedBy: "ai",
      },
      {
        key: "concession",
        label: "Concession card",
        value: null,
        required: true,
      },
    ],
    callId: "call-1003",
  },
]

const AGENT_SEEDS: Array<{
  id: string
  name: string
  role: string
  maxConcurrent: number
}> = [
  {
    id: "agent-david",
    name: "David Bailey",
    role: "Team Lead",
    maxConcurrent: 1,
  },
  {
    id: "agent-priya",
    name: "Priya Nair",
    role: "Energy Specialist",
    maxConcurrent: 1,
  },
  {
    id: "agent-liam",
    name: "Liam O'Connor",
    role: "Retention Specialist",
    maxConcurrent: 2,
  },
]

/** Idempotent — human agents are operational config, always ensured. */
export function ensureAgentsSeeded(db: DatabaseSync) {
  const exists = db
    .prepare("SELECT COUNT(*) AS n FROM human_agents")
    .get() as { n: number }
  if (Number(exists.n) > 0) return
  db.exec("BEGIN TRANSACTION")
  try {
    for (const agent of AGENT_SEEDS) {
      createHumanAgent(db, agent)
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function ensureSeeded(db: DatabaseSync) {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM journeys").get() as {
    n: number
  }
  if (Number(existing.n) > 0) return

  db.exec("BEGIN TRANSACTION")
  try {
    const insertJourney = db.prepare(
      `INSERT INTO journeys (id, customer_name, phone, email, retailer, state, status, abandon_step, do_not_call)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertField = db.prepare(
      `INSERT INTO journey_fields (id, journey_id, field_key, label, value, required, collected_by, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const journey of SEED_JOURNEYS) {
      insertJourney.run(
        journey.id,
        journey.customerName,
        journey.phone,
        journey.email,
        journey.retailer,
        journey.state,
        journey.status,
        journey.abandonStep,
        journey.doNotCall ? 1 : 0
      )
      journey.fields.forEach((field, position) => {
        insertField.run(
          `${journey.id}-field-${field.key}`,
          journey.id,
          field.key,
          field.label,
          field.value,
          field.required ? 1 : 0,
          field.collectedBy ?? null,
          position
        )
      })
      createCall(db, {
        id: journey.callId,
        journeyId: journey.id,
        status: "queued",
        provider: "sarvam",
      })
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}
