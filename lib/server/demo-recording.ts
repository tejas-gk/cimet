/**
 * Demo call recording generator.
 *
 * Composes sales-call audio using real Sarvam TTS (two different voices: the
 * sales agent and the customer), concatenated into a single 16kHz WAV with
 * silence gaps. The resulting file is a real audio file that is then fed
 * through the real STT + LLM audit pipeline — nothing is faked downstream.
 * These recordings are explicitly labelled as generated test fixtures.
 *
 * Scripts are kept deliberately short: Sarvam's synchronous STT API only
 * accepts files under 30 seconds, and the whole recording must fit under that
 * cap while still hitting every fact the auditor cross-checks.
 */

import { textToSpeech } from "@/lib/server/sarvam"
import { concatWavs, trimWav, wavDurationMs } from "@/lib/server/wav"
import type { AuditLeadFacts } from "@/lib/server/auditor"

export type ScenarioLine = {
  who: "agent" | "customer"
  text: string
}

export type DemoScenario = {
  id: string
  retailer: string
  leadName: string
  agentName: string
  customerEmail: string
  description: string
  /** CRM / plan facts the auditor cross-checks the spoken values against. */
  facts: Omit<
    AuditLeadFacts,
    "leadName" | "agentName" | "retailer" | "customerEmail"
  >
  script: ScenarioLine[]
}

const agentVoice = "shubh" // bulbul:v3 male
const customerVoice = "ritu" // bulbul:v3 female

export const demoScenarios: DemoScenario[] = [
  {
    id: "demo-pass",
    retailer: "AGL",
    leadName: "Bob Martinez",
    agentName: "Leo Chen",
    customerEmail: "bob.martinez@gmail.com",
    description:
      "Fully compliant call: disclaimer, correct peak rate (30.2c), email, address, concession and life-support. Expect auto-pass.",
    facts: {
      address: "42 Marine Parade, Bondi",
      postcode: "2026",
      concession: "no",
      lifeSupport: "no",
    },
    script: [
      {
        who: "agent",
        text: "Leo from CIMET. This call is recorded for quality and compliance.",
      },
      {
        who: "agent",
        text: "Your peak electricity rate is thirty point two cents per kilowatt hour.",
      },
      {
        who: "agent",
        text: "Your email, bob dot martinez at gmail dot com, and address 42 Marine Parade, Bondi, postcode 2026.",
      },
      {
        who: "agent",
        text: "Any concession card or life support at that address?",
      },
      {
        who: "customer",
        text: "No concession, no life support. Yes, the address is correct.",
      },
    ],
  },
  {
    id: "demo-hold-rate",
    retailer: "EnergyAustralia",
    leadName: "Alice Johnson",
    agentName: "Mia Patel",
    customerEmail: "alice@acme.com",
    description:
      "Agent states a peak rate (28.6c) below the retailer source-of-truth (31.9c). Expect a hold.",
    facts: {
      nmiMirn: "4102001234",
      fuelType: "electricity",
      concession: "no",
    },
    script: [
      {
        who: "agent",
        text: "Mia from CIMET, call recorded for quality and compliance.",
      },
      {
        who: "agent",
        text: "Your peak electricity rate is twenty eight point six cents per kilowatt hour.",
      },
      {
        who: "agent",
        text: "Your NMI is 4102001234, email alice at acme dot com. Concession card?",
      },
      {
        who: "customer",
        text: "My email is alice at acme dot com and no concession card.",
      },
    ],
  },
  {
    id: "demo-hold-email",
    retailer: "Origin",
    leadName: "David Chen",
    agentName: "Ava Singh",
    customerEmail: "david.chen@gmail.com",
    description:
      "Rate is correct but the customer verbally confirms a different email than the CRM (and the concession disclosure is skipped). Expect a hold.",
    facts: {
      address: "7 Collins Street, Melbourne",
      postcode: "3000",
      concession: "no",
    },
    script: [
      {
        who: "agent",
        text: "Ava from CIMET, call recorded for quality and compliance.",
      },
      {
        who: "agent",
        text: "Your peak rate is twenty nine point eight cents per kilowatt hour on Origin.",
      },
      {
        who: "agent",
        text: "Confirm your email and address 7 Collins Street, Melbourne 3000?",
      },
      {
        who: "customer",
        text: "My email is david dot chen at outlook dot com. And 7 Collins Street is my address.",
      },
    ],
  },
  {
    id: "demo-review",
    retailer: "Origin",
    leadName: "Priya Nair",
    agentName: "Rahul Verma",
    customerEmail: "priya.nair@gmail.com",
    description:
      "Compliant vessel but the peak rate and move-in date are never discussed. Expect human review.",
    facts: {
      concession: "no",
      moveInDate: "2026-11-01",
    },
    script: [
      {
        who: "agent",
        text: "Rahul from CIMET. This call is recorded for quality and compliance.",
      },
      {
        who: "agent",
        text: "I have you on Origin electricity, and your email is priya dot nair at gmail dot com.",
      },
      { who: "agent", text: "Do you hold a concession card?" },
      { who: "customer", text: "No concession card." },
      {
        who: "agent",
        text: "Great, I will send the proposal to your email today, thanks Priya.",
      },
    ],
  },
]

export type SynthesizedRecording = {
  scenario: DemoScenario
  audio: Buffer
  durationMs: number
}

export async function synthesizeDemoRecording(
  scenario: DemoScenario
): Promise<SynthesizedRecording> {
  const parts: Buffer[] = []
  for (const line of scenario.script) {
    const tts = await textToSpeech({
      text: line.text,
      speaker: line.who === "agent" ? agentVoice : customerVoice,
      sampleRate: 16000,
      codec: "wav",
    })
    parts.push(trimWav(tts.audio))
  }
  const audio = concatWavs(parts, 120)
  return {
    scenario,
    audio,
    durationMs: wavDurationMs(audio),
  }
}

/** Sarvam's synchronous STT endpoint only accepts files under 30 seconds. */
export const SYNC_STT_MAX_SECONDS = 30
