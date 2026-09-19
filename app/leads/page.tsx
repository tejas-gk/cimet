"use client"

import {
  Building2Icon,
  CalendarDaysIcon,
  ClipboardListIcon,
  ClipboardPlusIcon,
  ClockIcon,
  FuelIcon,
  HashIcon,
  HeadphonesIcon,
  HeartHandshakeIcon,
  HomeIcon,
  Loader2Icon,
  MailIcon,
  MapPinIcon,
  PencilLineIcon,
  PhoneIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  UploadIcon,
  UserIcon,
  ZapIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { LeadsDataGrid } from "@/components/leads-data-grid"
import LeadSolarPreview from "@/components/lead-solar-preview"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useLeads } from "@/hooks/use-leads"
import { useVoiceRecorder } from "@/hooks/use-voice-recorder"
import { formatMs } from "@/lib/cimet-demo-data"
import {
  leadProgress,
  loadAutoCall,
  loadAutoDialedLeadIds,
  saveAutoCall,
  saveAutoDialedLeadIds,
  type Lead,
  type QaStatus,
  type TranscriptSegment,
} from "@/lib/leads-store"
import type { PhoneProviderId } from "@/lib/server/phone/types"

function formatTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function qaBadge(status: QaStatus) {
  if (status === "auto-pass") return "border-emerald-500/40 text-emerald-300"
  if (status === "hold") return "border-red-500/40 text-red-300"
  if (status === "human-review") return "border-amber-500/40 text-amber-300"
  return "border-[#34363a] text-zinc-400"
}

function qaLabel(status: QaStatus) {
  if (status === "auto-pass") return "Pass"
  if (status === "hold") return "Hold"
  if (status === "human-review") return "Review"
  return "Pending"
}

export default function LeadsPage() {
  const { leads, getLead, upsertDraft } = useLeads()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [uploadState, setUploadState] = React.useState<{
    status: "idle" | "uploading" | "error"
    error?: string
  }>({ status: "idle" })
  const [qaState, setQaState] = React.useState<{
    status: "idle" | "running" | "error"
    error?: string
  }>({ status: "idle" })
  const [providerByLead, setProviderByLead] = React.useState<
    Record<string, PhoneProviderId>
  >({})
  const [dialing, setDialing] = React.useState<string | null>(null)
  const [dialState, setDialState] = React.useState<{
    leadId: string | null
    kind: "ok" | "error"
    message: string
  } | null>(null)
  const [autoCall, setAutoCall] = React.useState<boolean>(() => loadAutoCall())
  const autoDialedRef = React.useRef<Set<string>>(
    new Set(loadAutoDialedLeadIds())
  )
  const autoProcessingRef = React.useRef(false)
  const leadsRef = React.useRef(leads)
  React.useEffect(() => {
    leadsRef.current = leads
  }, [leads])

  const sorted = React.useMemo(
    () => [...leads].sort((a, b) => b.updatedAt - a.updatedAt),
    [leads]
  )
  const selected = selectedId ? getLead(selectedId) : null
  const draftCount = leads.filter((lead) => !lead.submitted).length

  const closeDrawer = () => {
    setSelectedId(null)
    setFile(null)
    setUploadState({ status: "idle" })
    setQaState({ status: "idle" })
  }

  async function handleUpload() {
    if (!selected || !file) return
    setUploadState({ status: "uploading" })
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(
        `/api/leads/${encodeURIComponent(selected.id)}/recording`,
        {
          method: "POST",
          body: form,
        }
      )
      const data = (await res.json().catch(() => null)) as {
        error?: string
        recordingUrl?: string | null
        transcript?: TranscriptSegment[]
      } | null
      if (!res.ok) {
        throw new Error(data?.error ?? `Upload failed (${res.status})`)
      }
      upsertDraft({
        id: selected.id,
        recordingUrl: data?.recordingUrl ?? null,
        transcript: Array.isArray(data?.transcript) ? data.transcript : [],
      })
      setFile(null)
      setUploadState({ status: "idle" })
    } catch (error) {
      setUploadState({
        status: "error",
        error: error instanceof Error ? error.message : "Transcription failed.",
      })
    }
  }

  const providerFor = (leadId: string) => providerByLead[leadId] ?? "twilio"

  const recorder = useVoiceRecorder()
  const [previewLeadId, setPreviewLeadId] = React.useState<string | null>(null)
  const [previewCallId, setPreviewCallId] = React.useState<string | null>(null)
  const [previewInitialAudio, setPreviewInitialAudio] = React.useState<
    string | null
  >(null)

  const placeCallFromPreview = React.useCallback(
    async (leadId: string) => {
      try {
        setDialState(null)
        const lead = getLead(leadId)
        const leadPayload = lead
          ? {
            id: lead.id,
            name: lead.name ?? "",
            phone: lead.phone ?? "",
            email: lead.email ?? "",
            retailer: lead.retailer ?? "",
            state: lead.state ?? "",
            address: lead.address ?? "",
            postcode: lead.postcode ?? "",
            dob: lead.dob ?? "",
            fuelType: lead.fuelType ?? "",
            nmiMirn: lead.nmiMirn ?? "",
            concession: lead.concession ?? "",
            lifeSupport: lead.lifeSupport ?? "",
            moveInDate: lead.moveInDate ?? "",
          }
          : { id: leadId }

        const res = await fetch(
          `/api/leads/${encodeURIComponent(leadId)}/phone`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              provider: providerFor(leadId),
              lead: leadPayload,
            }),
          }
        )
        const data = (await res.json().catch(() => null)) as any
        if (!res.ok)
          throw new Error(data?.error ?? `Call failed (${res.status})`)
        const callId = data?.data?.callId ?? data?.data?.call?.id ?? null
        if (!callId) throw new Error("Call not created")
        // Start the server-side call to get initial greeting audio
        const startRes = await fetch(
          `/api/calls/${encodeURIComponent(callId)}/start`,
          { method: "POST" }
        )
        const startData = (await startRes.json().catch(() => null)) as any
        const audio = startData?.data?.audioBase64 ?? null
        // Save callId into local lead draft for later sync
        upsertDraft({ id: leadId, callId })
        setPreviewCallId(callId)
        setPreviewInitialAudio(audio)
        setDialState({ leadId, kind: "ok", message: `Placed call ${callId}` })
        return callId
      } catch (err) {
        setDialState({
          leadId,
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to place call",
        })
        return null
      }
    },
    [providerFor]
  )

  // Provide a minimal leadContext for preview (expand as needed)
  const leadContextFor = React.useCallback(
    (leadId: string) => {
      const lead = getLead(leadId)
      if (!lead) return undefined
      return {
        name: lead.name ?? "",
        phone: lead.phone ?? "",
        email: lead.email ?? "",
        retailer: lead.retailer ?? "",
        state: lead.state ?? "",
        address: lead.address ?? "",
        postcode: lead.postcode ?? "",
      }
    },
    [getLead]
  )

  const handleExtractedData = React.useCallback(
    (data: Partial<Record<string, string>>) => {
      // Merge extracted fields into the local draft for the lead
      if (!previewLeadId) return
      upsertDraft({ id: previewLeadId, ...data })
    },
    [previewLeadId, upsertDraft]
  )

  const handleSaveRecording = React.useCallback(
    async (lines: Array<{ speaker: "customer" | "agent"; text: string }>) => {
      if (!previewLeadId) return
      try {
        // No audio upload / re-transcription in /leads — we just keep
        // whatever the preview conversation produced as the lead's transcript.
        const transcript: TranscriptSegment[] = lines
          .filter((line) => line.text && line.text.trim())
          .map((line, index) => ({
            id: `preview-${index}`,
            speaker: line.speaker,
            text: line.text.trim(),
            startMs: index * 3000,
            endMs: (index + 1) * 3000,
          }))
        if (transcript.length > 0) {
          upsertDraft({
            id: previewLeadId,
            transcript,
            humanInteracted: true,
          })
        }
      } catch (err) {
        console.warn("Saving preview transcript failed", err)
      }
    },
    [previewLeadId, upsertDraft]
  )

  const markDialed = React.useCallback((leadId: string) => {
    autoDialedRef.current.add(leadId)
    saveAutoDialedLeadIds([...autoDialedRef.current])
  }, [])

  async function runDial(lead: Lead): Promise<{
    ok: boolean
    message: string
    callId?: string | null
  }> {
    try {
      const res = await fetch(
        `/api/leads/${encodeURIComponent(lead.id)}/phone`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: providerFor(lead.id),
            lead: {
              name: lead.name,
              phone: lead.phone,
              email: lead.email,
              retailer: lead.retailer,
              state: lead.state,
              address: lead.address,
              postcode: lead.postcode,
              dob: lead.dob,
              fuelType: lead.fuelType,
              nmiMirn: lead.nmiMirn,
              concession: lead.concession,
              lifeSupport: lead.lifeSupport,
              moveInDate: lead.moveInDate,
            },
          }),
        }
      )
      const data = (await res.json().catch(() => null)) as any
      if (!res.ok) {
        throw new Error(data?.error ?? `Call failed (${res.status})`)
      }
      const callId =
        (data as any)?.data?.callId ?? (data as any)?.data?.call?.id ?? null
      return {
        ok: true,
        message: `Calling ${lead.phone} via ${providerFor(lead.id)} — the finished call will be audited automatically.`,
        // expose callId so callers (preview) can switch transport
        callId,
      }
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to start the phone call.",
      }
    }
  }

  async function handleDial(lead: Lead) {
    setDialing(lead.id)
    setDialState(null)
    const result = await runDial(lead)
    markDialed(lead.id)
    setDialState({
      leadId: lead.id,
      kind: result.ok ? "ok" : "error",
      message: result.message,
    })
    setDialing(null)
  }

  async function handleSync(lead: Lead) {
    try {
      const callId = (lead as any).callId
      if (!callId) {
        throw new Error("No call associated with this lead. Place a call first or ensure a callId is set.")
      }
      // The server sync endpoint expects a call id in the path (route uses calls table lookup).
      const res = await fetch(`/api/leads/${encodeURIComponent(callId)}/sync`, { method: "POST" })
      const data = (await res.json().catch(() => null)) as {
        data?: { fields?: Record<string, string> }
      } | null
      if (!res.ok)
        throw new Error(
          data?.data?.fields ? "Sync failed" : `Request failed (${res.status})`
        )
      const fields = data?.data?.fields ?? {}
      upsertDraft({
        id: lead.id,
        ...fields,
      })
      setDialState({
        leadId: lead.id,
        kind: "ok",
        message: "Form data synced from call.",
      })
    } catch (error) {
      setDialState({
        leadId: lead.id,
        kind: "error",
        message: error instanceof Error ? error.message : "Sync failed.",
      })
    }
  }

  // Auto-call: whenever the toggle is on, dial any submitted lead with a phone
  // number that has not been dialed yet, oldest first, one at a time.
  React.useEffect(() => {
    if (!autoCall) return
    if (autoProcessingRef.current) return
    void (async () => {
      autoProcessingRef.current = true
      try {
        for (; ;) {
          const next = [...leadsRef.current]
            .filter(
              (lead) =>
                lead.submitted &&
                !!lead.phone &&
                !autoDialedRef.current.has(lead.id)
            )
            .sort((a, b) => a.createdAt - b.createdAt)[0]
          if (!next) break
          const result = await runDial(next)
          markDialed(next.id)
          setDialState({
            leadId: next.id,
            kind: result.ok ? "ok" : "error",
            message: result.message,
          })
        }
      } finally {
        autoProcessingRef.current = false
      }
    })()
  }, [autoCall, leads, runDial, markDialed])

  async function runQualityAudit() {
    if (!selected || !selected.recordingUrl) return
    setQaState({ status: "running" })
    try {
      const audioRes = await fetch(selected.recordingUrl)
      if (!audioRes.ok)
        throw new Error(`Could not download the recording (${audioRes.status})`)
      const audioBlob = await audioRes.blob()

      const form = new FormData()
      form.append(
        "file",
        new File([audioBlob], "call.wav", {
          type: audioBlob.type || "audio/wav",
        })
      )
      form.append("leadId", selected.id)
      form.append("leadName", selected.name)
      form.append("agentName", "Maya Patel")
      form.append("retailer", selected.retailer)
      form.append("customerEmail", selected.email)
      form.append("address", selected.address)
      form.append("postcode", selected.postcode)
      form.append("dob", selected.dob)
      form.append("fuelType", selected.fuelType)
      form.append("nmiMirn", selected.nmiMirn)
      form.append("concession", selected.concession)
      form.append("lifeSupport", selected.lifeSupport)
      form.append("moveInDate", selected.moveInDate)

      const res = await fetch("/api/audits/upload", {
        method: "POST",
        body: form,
      })
      const data = (await res.json().catch(() => null)) as {
        error?: string
        audit?: {
          id?: string
          status?: QaStatus
          confidence?: number | null
          aiSummary?: string | null
        }
      } | null
      if (!res.ok)
        throw new Error(data?.error ?? `Audit failed (${res.status})`)
      if (!data?.audit) throw new Error("Audit did not return a result.")

      upsertDraft({
        id: selected.id,
        qaStatus: data.audit.status ?? "human-review",
        qaAuditId: data.audit.id ?? null,
        qaConfidence: data.audit.confidence ?? null,
        qaSummary: data.audit.aiSummary ?? null,
      })
      setQaState({ status: "idle" })
    } catch (error) {
      setQaState({
        status: "error",
        error: error instanceof Error ? error.message : "Quality audit failed.",
      })
    }
  }

  return (
    <CimetAiShell>
      <div className="mx-auto grid w-full min-w-0 gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Leads</h2>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className="border-[#34363a] bg-[#111113] text-zinc-200"
            >
              {leads.length} total
            </Badge>
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-200"
            >
              {draftCount} in progress
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              title="When on, every newly submitted lead with a phone number is dialed automatically."
              className={
                autoCall
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-100"
                  : "border-[#34363a] bg-[#111113] text-zinc-300"
              }
              onClick={() => {
                const next = !autoCall
                setAutoCall(next)
                saveAutoCall(next)
              }}
            >
              <PhoneIcon className="size-4" /> Auto call
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${autoCall
                  ? "bg-emerald-500/20 text-emerald-100"
                  : "bg-[#222226] text-zinc-500"
                  }`}
              >
                {autoCall ? "ON" : "OFF"}
              </span>
            </Button>
            <Button size="sm" asChild>
              <Link href="/lead-form">
                <ClipboardPlusIcon className="size-4" /> New lead
              </Link>
            </Button>
          </div>
        </div>

        {dialState && (
          <p
            role="status"
            className={`text-sm ${dialState.kind === "ok" ? "text-emerald-300" : "text-red-300"}`}
          >
            {dialState.message}
          </p>
        )}

        <LeadsDataGrid
          leads={sorted}
          onUpdate={upsertDraft}
          onOpen={setSelectedId}
          renderActions={(lead) => (
            <>
              <div className="flex items-center gap-2">
                <Select
                  value={providerFor(lead.id)}
                  onValueChange={(value) =>
                    setProviderByLead((prev) => ({
                      ...prev,
                      [lead.id]: value as PhoneProviderId,
                    }))
                  }
                  disabled={dialing === lead.id}
                >
                  <SelectTrigger className="h-6 w-[100px] border-[#34363a] bg-transparent text-xs text-white">
                    <SelectValue />
                  </SelectTrigger>
<SelectContent>
    <SelectItem value="twilio">Twilio</SelectItem>
    <SelectItem value="retell">Retell</SelectItem>
    <SelectItem value="vapi">Vapi</SelectItem>
    <SelectItem value="exotel">Exotel</SelectItem>
</SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#34363a] bg-[#111113] text-white"
                  disabled={dialing === lead.id}
                  onClick={() => {
                    setPreviewCallId(null)
                    setPreviewLeadId(lead.id)
                  }}
                >
                  <HeadphonesIcon className="size-4" />
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                  disabled={!lead.phone || dialing === lead.id}
                  onClick={() => handleDial(lead)}
                >
                  {dialing === lead.id ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <PhoneIcon className="size-4" />
                  )}
                  Call
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#34363a] bg-[#111113] text-white"
                  disabled={dialing === lead.id}
                  onClick={() => handleSync(lead)}
                >
                  <RefreshCwIcon className="size-4" /> Sync
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#34363a] bg-[#111113] text-white"
                  asChild
                >
                  <Link href={`/leads/${lead.id}`}>Open</Link>
                </Button>
              </div>
            </>
          )}
        />

        {previewLeadId ? (
          <div className="fixed top-0 left-0 z-50 flex h-full w-full items-start justify-center p-6">
            <div className="pointer-events-auto">
              <LeadSolarPreview
                onClose={() => {
                  setPreviewLeadId(null)
                  setPreviewCallId(null)
                  setPreviewInitialAudio(null)
                }}
                leadId={previewLeadId}
                callId={previewCallId}
                initialAudio={previewInitialAudio}
                onPlaceCall={async (leadId) => {
                  const callId = await placeCallFromPreview(leadId)
                  return callId
                }}
                onExtractedData={handleExtractedData}
                onSaveRecording={handleSaveRecording}
              />
            </div>
          </div>
        ) : null}

        <Sheet
          open={selectedId !== null}
          onOpenChange={(open) => !open && setSelectedId(null)}
        >
          <SheetContent className="w-full border-[#27272a] bg-[#0d0d0f] text-white sm:max-w-md">
            {selected ? (
              <>
                <SheetHeader>
                  <SheetTitle className="text-white">
                    {selected.name || "Unnamed lead"}
                  </SheetTitle>
                  <SheetDescription className="text-zinc-400">
                    {selected.company || "No company provided"}
                  </SheetDescription>
                </SheetHeader>

                <div className="px-4">
                  {selected.submitted ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 text-emerald-300"
                    >
                      Submitted
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 text-amber-300"
                    >
                      Draft — in progress
                    </Badge>
                  )}
                </div>

                <div className="grid gap-4 overflow-y-auto px-4 pb-4">
                  <section>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                      <UserIcon className="size-3.5" /> Contact
                    </h4>
                    <div className="grid gap-2 rounded-xl border border-[#242427] bg-[#111113] p-4 text-sm">
                      <Row
                        icon={<MailIcon className="size-3.5" />}
                        label="Email"
                        value={selected.email}
                      />
                      <Row
                        icon={<PhoneIcon className="size-3.5" />}
                        label="Phone"
                        value={selected.phone}
                      />
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                      <Building2Icon className="size-3.5" /> Details
                    </h4>
                    <div className="grid gap-2 rounded-xl border border-[#242427] bg-[#111113] p-4 text-sm">
                      <Row
                        icon={<MapPinIcon className="size-3.5" />}
                        label="State"
                        value={selected.state}
                      />
                      <Row
                        icon={<ZapIcon className="size-3.5" />}
                        label="Plan"
                        value={selected.plan}
                      />
                      <Row
                        icon={<ZapIcon className="size-3.5" />}
                        label="Monthly bill"
                        value={selected.usage}
                      />
                      <Row
                        icon={<MailIcon className="size-3.5" />}
                        label="Consent"
                        value={selected.consent ? "Consented" : "Not provided"}
                      />
                      <Row
                        icon={<Building2Icon className="size-3.5" />}
                        label="Retailer"
                        value={selected.retailer}
                      />
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                      <HomeIcon className="size-3.5" /> Energy facts
                    </h4>
                    <div className="grid gap-2 rounded-xl border border-[#242427] bg-[#111113] p-4 text-sm">
                      <Row
                        icon={<MapPinIcon className="size-3.5" />}
                        label="Address"
                        value={selected.address}
                      />
                      <Row
                        icon={<MapPinIcon className="size-3.5" />}
                        label="Postcode"
                        value={selected.postcode}
                      />
                      <Row
                        icon={<CalendarDaysIcon className="size-3.5" />}
                        label="Date of birth"
                        value={selected.dob}
                      />
                      <Row
                        icon={<FuelIcon className="size-3.5" />}
                        label="Fuel type"
                        value={selected.fuelType}
                      />
                      <Row
                        icon={<HashIcon className="size-3.5" />}
                        label="NMI / MIRN"
                        value={selected.nmiMirn}
                      />
                      <Row
                        icon={<HeartHandshakeIcon className="size-3.5" />}
                        label="Concession"
                        value={
                          selected.concession === "yes"
                            ? "Yes"
                            : selected.concession === "no"
                              ? "No"
                              : undefined
                        }
                      />
                      <Row
                        icon={<HeartHandshakeIcon className="size-3.5" />}
                        label="Life support"
                        value={
                          selected.lifeSupport === "yes"
                            ? "Yes"
                            : selected.lifeSupport === "no"
                              ? "No"
                              : undefined
                        }
                      />
                      <Row
                        icon={<CalendarDaysIcon className="size-3.5" />}
                        label="Move-in date"
                        value={selected.moveInDate}
                      />
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                      <ClipboardPlusIcon className="size-3.5" /> Message
                    </h4>
                    <div className="rounded-xl border border-[#242427] bg-[#111113] p-4 text-sm text-zinc-200">
                      {selected.message || "No message provided."}
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                      <HeadphonesIcon className="size-3.5" /> Recording & real
                      transcript
                    </h4>
                    {selected.transcript.length > 0 ? (
                      <div className="grid gap-3">
                        {selected.recordingUrl ? (
                          <audio
                            controls
                            src={selected.recordingUrl}
                            className="w-full"
                          />
                        ) : null}
                        <Badge
                          variant="outline"
                          className="w-fit border-emerald-500/40 text-xs text-emerald-300"
                        >
                          {selected.recordingUrl
                            ? "Real transcript — transcribed from the uploaded recording"
                            : "Real transcript — captured from the preview conversation"}
                        </Badge>
                        <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
                          {selected.transcript.map((segment) => (
                            <div
                              key={segment.id}
                              className="rounded-lg border border-[#34363a] bg-[#141416] p-3"
                            >
                              <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
                                <span className="tracking-wide uppercase">
                                  {segment.speaker}
                                </span>
                                <span>{formatMs(segment.startMs)}</span>
                              </div>
                              <div className="text-sm leading-6 text-zinc-100">
                                {segment.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-3 rounded-xl border border-[#242427] bg-[#111113] p-4">
                        <p className="text-sm text-zinc-400">
                          Upload the real call recording for this lead. It will
                          be transcribed to a real transcript via Sarvam.
                        </p>
                        <label className="grid cursor-pointer gap-1">
                          <span className="text-xs text-zinc-500">
                            Audio file (wav, mp3, m4a, ogg, flac, webm)
                          </span>
                          <input
                            type="file"
                            accept=".wav,.mp3,.m4a,.ogg,.flac,.webm,audio/*"
                            disabled={uploadState.status === "uploading"}
                            onChange={(event) => {
                              setFile(event.target.files?.[0] ?? null)
                              setUploadState({ status: "idle" })
                            }}
                            className="block w-full text-xs text-zinc-500 file:mr-2 file:rounded-md file:border file:border-[#34363a] file:bg-[#1c1c1f] file:px-2.5 file:py-1 file:text-xs file:text-zinc-100"
                          />
                          {file ? (
                            <span className="truncate text-xs text-zinc-300">
                              {file.name}
                            </span>
                          ) : null}
                        </label>
                        <Button
                          size="sm"
                          disabled={!file || uploadState.status === "uploading"}
                          onClick={handleUpload}
                        >
                          {uploadState.status === "uploading" ? (
                            <>
                              <Loader2Icon className="size-4 animate-spin" />{" "}
                              Transcribing… (can take a minute)
                            </>
                          ) : (
                            <>
                              <UploadIcon className="size-4" /> Upload &
                              transcribe
                            </>
                          )}
                        </Button>
                        {uploadState.status === "error" ? (
                          <p className="text-xs text-red-300">
                            {uploadState.error}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </section>

                  <section>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                      <ShieldCheckIcon className="size-3.5" /> Quality audit
                    </h4>
                    {selected.qaStatus !== "pending" ? (
                      <div className="grid gap-3 rounded-xl border border-[#242427] bg-[#111113] p-4">
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant="outline"
                            className={qaBadge(selected.qaStatus)}
                          >
                            {qaLabel(selected.qaStatus)}
                          </Badge>
                          {typeof selected.qaConfidence === "number" ? (
                            <span className="text-xs text-zinc-500">
                              {selected.qaConfidence}% confidence
                            </span>
                          ) : null}
                        </div>
                        {selected.qaSummary ? (
                          <p className="text-sm leading-6 text-zinc-300">
                            {selected.qaSummary}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {selected.qaAuditId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-[#34363a] bg-[#111113] text-white"
                              asChild
                            >
                              <Link href={`/auditor/${selected.qaAuditId}`}>
                                <ClipboardListIcon className="size-4" /> Open
                                audit details
                              </Link>
                            </Button>
                          ) : null}
                          {selected.recordingUrl ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-[#34363a] bg-[#111113] text-white"
                              disabled={qaState.status === "running"}
                              onClick={runQualityAudit}
                            >
                              {qaState.status === "running" ? (
                                <>
                                  <Loader2Icon className="size-4 animate-spin" />{" "}
                                  Re-running…
                                </>
                              ) : (
                                <>
                                  <ShieldCheckIcon className="size-4" /> Run
                                  audit again
                                </>
                              )}
                            </Button>
                          ) : null}
                        </div>
                        {qaState.status === "error" ? (
                          <p className="text-xs text-red-300">
                            {qaState.error}
                          </p>
                        ) : null}
                      </div>
                    ) : selected.recordingUrl &&
                      selected.transcript.length > 0 ? (
                      <div className="grid gap-3 rounded-xl border border-[#242427] bg-[#111113] p-4">
                        <p className="text-sm text-zinc-400">
                          Run the AI Quality Auditor on this call. It checks the
                          recorded script, extracts spoken facts and
                          cross-checks them against the lead details, and
                          reviews agent behaviour — then returns a pass / hold /
                          review ruling with evidence.
                        </p>
                        <Button
                          size="sm"
                          disabled={qaState.status === "running"}
                          onClick={runQualityAudit}
                        >
                          {qaState.status === "running" ? (
                            <>
                              <Loader2Icon className="size-4 animate-spin" />{" "}
                              Running quality audit…
                            </>
                          ) : (
                            <>
                              <ShieldCheckIcon className="size-4" /> Run quality
                              audit
                            </>
                          )}
                        </Button>
                        {qaState.status === "error" ? (
                          <p className="text-xs text-red-300">
                            {qaState.error}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="grid gap-3 rounded-xl border border-[#242427] bg-[#111113] p-4">
                        <p className="text-sm text-zinc-400">
                          Upload and transcribe this lead&apos;s call recording
                          to unlock the quality audit.
                        </p>
                      </div>
                    )}
                  </section>

                  <section>
                    <h4 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                      <ClockIcon className="size-3.5" /> Timeline
                    </h4>
                    <div className="grid gap-2 rounded-xl border border-[#242427] bg-[#111113] p-4 text-sm text-zinc-300">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Progress</span>
                        <span>{leadProgress(selected)}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Created</span>
                        <span>{formatTime(selected.createdAt)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Updated</span>
                        <span>{formatTime(selected.updatedAt)}</span>
                      </div>
                    </div>
                  </section>
                </div>

                <div className="mt-auto grid gap-2 border-t border-[#27272a] p-4">
                  {!selected.submitted ? (
                    <Button size="sm" asChild>
                      <Link href={`/lead-form?id=${selected.id}`}>
                        <PencilLineIcon className="size-4" /> Continue editing
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-[#34363a] bg-[#111113] text-white"
                    onClick={closeDrawer}
                  >
                    Close
                  </Button>
                </div>
              </>
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </CimetAiShell>
  )
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string | undefined
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="flex items-center gap-2 text-zinc-500">
        {icon} {label}
      </span>
      <span className="text-right text-zinc-100">{value || "—"}</span>
    </div>
  )
}
