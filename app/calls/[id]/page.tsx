"use client"

import { useParams } from "next/navigation"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { VoiceAgentDetail } from "@/components/voice-agent-detail"

export default function CallDetailPage() {
  const params = useParams<{ id: string }>()
  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-7xl gap-5">
        <VoiceAgentDetail callId={params.id} />
      </div>
    </CimetAiShell>
  )
}
