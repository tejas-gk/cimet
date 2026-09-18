"use client"

import { useParams } from "next/navigation"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { QualityAuditDetail } from "@/components/quality-audit-detail"

export default function AuditDetailPage() {
  const params = useParams<{ id: string }>()
  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-7xl gap-5">
        <QualityAuditDetail auditId={params.id} />
      </div>
    </CimetAiShell>
  )
}
