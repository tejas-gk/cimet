import type { DatabaseSync } from "node:sqlite"

import type { AuditRun, CallSession } from "@/lib/cimet-ai-types"

export type PhoneDialResult = {
  provider: string
  providerCallId: string
  call: CallSession
}

export type PhoneProviderId = "twilio" | "retell" | "vapi"

export type PhoneTurnResult = {
  twiml: string
  audit?: AuditRun | null
}

export interface PhoneProvider {
  id: PhoneProviderId
  dial(db: DatabaseSync, callId: string): Promise<PhoneDialResult>
  initialTwiml(db: DatabaseSync, callId: string): Promise<string>
  turnTwiml(
    db: DatabaseSync,
    callId: string,
    speech: string
  ): Promise<PhoneTurnResult>
  status(db: DatabaseSync, callId: string, form: FormData): Promise<void>
  recording(
    db: DatabaseSync,
    callId: string,
    form: FormData
  ): Promise<AuditRun | null>
}
