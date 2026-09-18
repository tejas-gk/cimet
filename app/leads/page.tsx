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
  ShieldCheckIcon,
  UploadIcon,
  UserIcon,
  ZapIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
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
import { formatMs } from "@/lib/cimet-demo-data"
import {
  leadProgress,
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

  async function handleDial(lead: Lead) {
    setDialing(lead.id)
    setDialState(null)
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
      const data = (await res.json().catch(() => null)) as {
        error?: string
        data?: { provider?: string; callId?: string }
      } | null
      if (!res.ok) {
        throw new Error(data?.error ?? `Call failed (${res.status})`)
      }
      setDialState({
        leadId: lead.id,
        kind: "ok",
        message: `Calling ${lead.phone} via ${providerFor(lead.id)} — the finished call will be audited automatically.`,
      })
    } catch (error) {
      setDialState({
        leadId: lead.id,
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to start the phone call.",
      })
    } finally {
      setDialing(null)
    }
  }

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
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="grid gap-2">
          <Badge
            variant="outline"
            className="w-fit border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          >
            Lead capture
          </Badge>
          <h2 className="text-2xl font-semibold tracking-tight">Leads</h2>
          <p className="max-w-3xl text-sm text-zinc-400">
            Every lead from the multi-step form lands here. Click any row to
            open its full details in a drawer.
          </p>
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
          <Button size="sm" asChild>
            <Link href="/lead-form">
              <ClipboardPlusIcon className="size-4" /> New lead
            </Link>
          </Button>
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c] p-10 text-center">
            <div className="text-sm text-zinc-400">
              No leads yet. Submit the multi-step form to add your first one.
            </div>
            <Button size="sm" className="mt-4" asChild>
              <Link href="/lead-form">Open lead form</Link>
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#27272a] bg-[#0b0b0c]">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#27272a] text-left text-xs tracking-wide text-zinc-500 uppercase">
                  <th className="px-4 py-3 font-medium">Lead</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Recording</th>
                  <th className="px-4 py-3 font-medium">Quality audit</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium">Call by phone</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedId(lead.id)}
                    className="cursor-pointer border-b border-[#1c1c1f] transition-colors last:border-b-0 hover:bg-[#141416]"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-100">
                        {lead.name || "Unnamed lead"}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {lead.company || "No company provided"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-zinc-200">{lead.email || "—"}</div>
                      <div className="text-xs text-zinc-500">
                        {lead.phone || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {lead.plan || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#222226]">
                          <div
                            className={
                              lead.submitted
                                ? "h-full bg-emerald-500"
                                : "h-full bg-amber-400"
                            }
                            style={{
                              width: `${Math.max(4, leadProgress(lead))}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-zinc-500">
                          {leadProgress(lead)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {lead.recordingUrl && lead.transcript.length > 0 ? (
                        <span className="flex items-center gap-1.5 text-xs text-emerald-300">
                          <HeadphonesIcon className="size-3.5" /> Transcribed
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-600">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={qaBadge(lead.qaStatus)}
                      >
                        {qaLabel(lead.qaStatus)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {lead.submitted ? (
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
                          Draft
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {formatTime(lead.updatedAt)}
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
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
                          <SelectTrigger className="h-8 w-[110px] border-[#34363a] bg-[#111113] text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="twilio">Twilio</SelectItem>
                            <SelectItem value="retell">Retell</SelectItem>
                            <SelectItem value="vapi">Vapi</SelectItem>
                          </SelectContent>
                        </Select>
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
                          asChild
                        >
                          <Link href={`/leads/${lead.id}`}>Open</Link>
                        </Button>
                      </div>
                      {dialState?.leadId === lead.id ? (
                        <p
                          className={`mt-1 max-w-[220px] text-xs ${dialState.kind === "ok" ? "text-emerald-300" : "text-red-300"}`}
                        >
                          {dialState.message}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Sheet
          open={selectedId !== null}
          onOpenChange={(open) => !open && setSelectedId(null)}
        >
          <SheetContent className="w-full border-[#27272a] bg-[#0d0d0f] text-white sm:max-w-sm">
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
                    {selected.recordingUrl && selected.transcript.length > 0 ? (
                      <div className="grid gap-3">
                        <audio
                          controls
                          src={selected.recordingUrl}
                          className="w-full"
                        />
                        <Badge
                          variant="outline"
                          className="w-fit border-emerald-500/40 text-xs text-emerald-300"
                        >
                          Real transcript — transcribed from the uploaded
                          recording
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
