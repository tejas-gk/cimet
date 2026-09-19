"use client"

import {
  Building2Icon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardPlusIcon,
  FileTextIcon,
  FuelIcon,
  HashIcon,
  HeartHandshakeIcon,
  HomeIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  SendIcon,
  UserIcon,
  ZapIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { CimetAiShell } from "@/components/cimet-ai-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useLeads } from "@/hooks/use-leads"
import {
  ENERGY_PLANS,
  ENERGY_STATES,
  FUEL_TYPES,
  leadProgress,
  loadLeads,
  RETAILERS,
  USAGE_TIERS,
  YES_NO,
} from "@/lib/leads-store"

type LeadFormState = {
  name: string
  email: string
  phone: string
  company: string
  state: string
  retailer: string
  plan: string
  usage: string
  message: string
  consent: boolean
  address: string
  postcode: string
  dob: string
  fuelType: string
  nmiMirn: string
  concession: string
  lifeSupport: string
  moveInDate: string
}

const emptyForm: LeadFormState = {
  name: "",
  email: "",
  phone: "",
  company: "",
  state: "",
  retailer: "",
  plan: "",
  usage: "",
  message: "",
  consent: false,
  address: "",
  postcode: "",
  dob: "",
  fuelType: "",
  nmiMirn: "",
  concession: "",
  lifeSupport: "",
  moveInDate: "",
}

const stepTitles = [
  "Contact details",
  "Energy details",
  "Plan & market",
  "Message & review",
]

function formatTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export default function LeadFormPage() {
  const { upsertDraft, submitLead, getLead } = useLeads()
  const [form, setFormState] = React.useState<LeadFormState>(emptyForm)
  const [step, setStep] = React.useState(0)
  const [lastStep, setLastStepState] = React.useState(0)
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [submitted, setSubmitted] = React.useState(false)
  const [resumed, setResumed] = React.useState(false)
  const [autosave, setAutosave] = React.useState(false)

  const formRef = React.useRef(form)
  const stepRef = React.useRef(step)
  const lastStepRef = React.useRef(lastStep)
  const activeIdRef = React.useRef<string | null>(null)

  const setForm = (next: LeadFormState) => {
    formRef.current = next
    setFormState(next)
  }

  function ensureDraft() {
    if (activeIdRef.current) return
    const fresh = `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    activeIdRef.current = fresh
    setActiveId(fresh)
  }

  const persist = React.useCallback(() => {
    const id = activeIdRef.current
    if (!id) return
    upsertDraft({ id, ...formRef.current, lastStep: lastStepRef.current })
    setAutosave(true)
  }, [upsertDraft])

  function updateField<K extends keyof LeadFormState>(
    key: K,
    value: LeadFormState[K]
  ) {
    const next = { ...formRef.current, [key]: value }
    setForm(next)
    ensureDraft()
    persist()
  }

  function jumpTo(next: number) {
    stepRef.current = next
    setStep(next)
    if (next > lastStepRef.current) {
      lastStepRef.current = next
      setLastStepState(next)
    }
    persist()
  }

  function handleSubmit() {
    ensureDraft()
    persist()
    const id = activeIdRef.current
    if (!id) return
    submitLead(id)
    setSubmitted(true)
  }

  function resetForm() {
    formRef.current = emptyForm
    stepRef.current = 0
    lastStepRef.current = 0
    activeIdRef.current = null
    setForm(emptyForm)
    setStep(0)
    setLastStepState(0)
    setActiveId(null)
    setSubmitted(false)
    setResumed(false)
    setAutosave(false)
  }

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedId = params.get("id")
    const all = loadLeads()
    const requested = requestedId
      ? (all.find((lead) => lead.id === requestedId) ?? null)
      : null
    const draft =
      requested ??
      all
        .filter((lead) => !lead.submitted)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
      null
    if (draft) {
      activeIdRef.current = draft.id
      setActiveId(draft.id)
      setForm({
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        company: draft.company,
        state: draft.state,
        retailer: draft.retailer,
        plan: draft.plan,
        usage: draft.usage,
        message: draft.message,
        consent: draft.consent,
        address: draft.address,
        postcode: draft.postcode,
        dob: draft.dob,
        fuelType: draft.fuelType,
        nmiMirn: draft.nmiMirn,
        concession: draft.concession,
        lifeSupport: draft.lifeSupport,
        moveInDate: draft.moveInDate,
      })
      stepRef.current = draft.lastStep
      lastStepRef.current = draft.lastStep
      setStep(draft.lastStep)
      setLastStepState(draft.lastStep)
      setResumed(true)
    }
  }, [])

  if (submitted) {
    return (
      <CimetAiShell>
        <div className="mx-auto grid max-w-2xl gap-5">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
            <div className="flex items-center gap-2 text-emerald-200">
              <CheckCircle2Icon className="size-5" />
              <h2 className="text-lg font-semibold">Lead submitted</h2>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              {form.name ? `Thanks, ${form.name}. ` : "Thanks — "}Your lead has
              been saved and is now visible in the leads table.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link href="/leads">View in Leads</Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-[#34363a] bg-[#111113] text-white"
                onClick={resetForm}
              >
                Start another lead
              </Button>
            </div>
          </div>
        </div>
      </CimetAiShell>
    )
  }

  const progress = leadProgress(form)
  const activeLead = activeId ? getLead(activeId) : null
  const canSubmit =
    form.name.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.phone.trim().length > 0

  return (
    <CimetAiShell>
      <div className="mx-auto grid max-w-3xl gap-5">
        <div className="grid gap-2">
          <Badge
            variant="outline"
            className="w-fit border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          >
            Lead capture
          </Badge>
          <h2 className="text-2xl font-semibold tracking-tight">
            Tell us about your energy needs
          </h2>
          <p className="text-sm text-zinc-400">
            Everything is saved as you type. You can leave halfway and come back
            to continue later.
          </p>
        </div>

        {resumed ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
            <div className="text-sm text-sky-100">
              Editing the draft you started on{" "}
              {activeLead ? formatTime(activeLead.createdAt) : "earlier"}.
            </div>
            <Button
              size="xs"
              variant="outline"
              className="border-sky-500/40 bg-sky-500/10 text-sky-100"
              onClick={resetForm}
            >
              Start fresh
            </Button>
          </div>
        ) : null}

        <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stepTitles.map((title, index) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => index <= lastStep && jumpTo(index)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    index === step
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100"
                      : index <= lastStep
                        ? "border-[#27272a] bg-[#111113] text-zinc-200 hover:border-[#34363a]"
                        : "cursor-default border-[#1c1c1f] text-zinc-600"
                  }`}
                >
                  <span
                    className={`flex size-5 items-center justify-center rounded-full text-xs font-medium ${
                      index < step
                        ? "bg-emerald-500 text-black"
                        : index === step
                          ? "bg-emerald-500/20 text-emerald-200"
                          : "bg-[#222226] text-zinc-500"
                    }`}
                  >
                    {index < step ? (
                      <CheckCircle2Icon className="size-3" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="hidden sm:inline">{title}</span>
                </button>
              ))}
            </div>
            {autosave ? (
              <div className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-500">
                <ClipboardPlusIcon className="size-3.5" />
                Draft saved
                {activeLead ? (
                  <span className="hidden text-zinc-600 sm:inline">
                    · {formatTime(activeLead.updatedAt)}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#222226]">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-zinc-500">{progress}% complete</div>
        </div>

        <div className="rounded-xl border border-[#27272a] bg-[#0b0b0c] p-5">
          {step === 0 ? (
            <div className="grid gap-4">
              <Field
                icon={<UserIcon className="size-4" />}
                label="Full name"
                hint="Required"
              >
                <Input
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder="Jane Cooper"
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </Field>
              <Field
                icon={<MailIcon className="size-4" />}
                label="Email address"
                hint="Required"
              >
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  placeholder="jane@example.com"
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </Field>
              <Field
                icon={<PhoneIcon className="size-4" />}
                label="Phone number"
                hint="Required"
              >
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  placeholder="0400 000 000"
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </Field>
              <Field
                icon={<Building2Icon className="size-4" />}
                label="Company or organisation"
                hint="Optional"
              >
                <Input
                  value={form.company}
                  onChange={(event) =>
                    updateField("company", event.target.value)
                  }
                  placeholder="Acme Energy Co"
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  icon={<HomeIcon className="size-4" />}
                  label="Service address"
                  hint="Quality audit"
                >
                  <Input
                    value={form.address}
                    onChange={(event) =>
                      updateField("address", event.target.value)
                    }
                    placeholder="25 Smith Street"
                    className="border-[#27272a] bg-[#111113] text-white"
                  />
                </Field>
                <Field
                  icon={<MapPinIcon className="size-4" />}
                  label="Postcode"
                  hint="Quality audit"
                >
                  <Input
                    value={form.postcode}
                    onChange={(event) =>
                      updateField("postcode", event.target.value)
                    }
                    placeholder="2000"
                    className="border-[#27272a] bg-[#111113] text-white"
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  icon={<CalendarDaysIcon className="size-4" />}
                  label="Date of birth"
                  hint="Quality audit"
                >
                  <Input
                    type="date"
                    value={form.dob}
                    onChange={(event) => updateField("dob", event.target.value)}
                    className="border-[#27272a] bg-[#111113] text-white"
                  />
                </Field>
                <Field
                  icon={<FuelIcon className="size-4" />}
                  label="Fuel type"
                  hint="Quality audit"
                >
                  <Select
                    value={form.fuelType}
                    onValueChange={(value) => updateField("fuelType", value)}
                  >
                    <SelectTrigger className="w-full border-[#27272a] bg-[#111113] text-white">
                      <SelectValue placeholder="Electricity or gas" />
                    </SelectTrigger>
                    <SelectContent>
                      {FUEL_TYPES.map((fuel) => (
                        <SelectItem key={fuel} value={fuel}>
                          {fuel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field
                icon={<HashIcon className="size-4" />}
                label="NMI / MIRN"
                hint="Quality audit"
              >
                <Input
                  value={form.nmiMirn}
                  onChange={(event) =>
                    updateField("nmiMirn", event.target.value)
                  }
                  placeholder="4102001234"
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  icon={<HeartHandshakeIcon className="size-4" />}
                  label="Concession card holder"
                  hint="Quality audit"
                >
                  <Select
                    value={form.concession}
                    onValueChange={(value) => updateField("concession", value)}
                  >
                    <SelectTrigger className="w-full border-[#27272a] bg-[#111113] text-white">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {YES_NO.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  icon={<HeartHandshakeIcon className="size-4" />}
                  label="Life support required"
                  hint="Quality audit"
                >
                  <Select
                    value={form.lifeSupport}
                    onValueChange={(value) => updateField("lifeSupport", value)}
                  >
                    <SelectTrigger className="w-full border-[#27272a] bg-[#111113] text-white">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {YES_NO.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field
                icon={<CalendarDaysIcon className="size-4" />}
                label="Move-in date"
                hint="Quality audit"
              >
                <Input
                  type="date"
                  value={form.moveInDate}
                  onChange={(event) =>
                    updateField("moveInDate", event.target.value)
                  }
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  icon={<MapPinIcon className="size-4" />}
                  label="State / market"
                  hint="Optional"
                >
                  <Select
                    value={form.state}
                    onValueChange={(value) => updateField("state", value)}
                  >
                    <SelectTrigger className="w-full border-[#27272a] bg-[#111113] text-white">
                      <SelectValue placeholder="Select a state" />
                    </SelectTrigger>
                    <SelectContent>
                      {ENERGY_STATES.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  icon={<Building2Icon className="size-4" />}
                  label="Retailer"
                  hint="Determines the QA checklist"
                >
                  <Select
                    value={form.retailer}
                    onValueChange={(value) => updateField("retailer", value)}
                  >
                    <SelectTrigger className="w-full border-[#27272a] bg-[#111113] text-white">
                      <SelectValue placeholder="Choose a retailer" />
                    </SelectTrigger>
                    <SelectContent>
                      {RETAILERS.map((retailer) => (
                        <SelectItem key={retailer} value={retailer}>
                          {retailer}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  icon={<ZapIcon className="size-4" />}
                  label="Interested plan"
                  hint="Optional"
                >
                  <Select
                    value={form.plan}
                    onValueChange={(value) => updateField("plan", value)}
                  >
                    <SelectTrigger className="w-full border-[#27272a] bg-[#111113] text-white">
                      <SelectValue placeholder="Choose a plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {ENERGY_PLANS.map((plan) => (
                        <SelectItem key={plan} value={plan}>
                          {plan}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  icon={<ZapIcon className="size-4" />}
                  label="Current monthly bill"
                  hint="Optional"
                >
                  <Select
                    value={form.usage}
                    onValueChange={(value) => updateField("usage", value)}
                  >
                    <SelectTrigger className="w-full border-[#27272a] bg-[#111113] text-white">
                      <SelectValue placeholder="Estimate your monthly usage" />
                    </SelectTrigger>
                    <SelectContent>
                      {USAGE_TIERS.map((tier) => (
                        <SelectItem key={tier} value={tier}>
                          {tier}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4">
              <Field
                icon={<FileTextIcon className="size-4" />}
                label="Message"
                hint="Optional — anything else we should know"
              >
                <Textarea
                  value={form.message}
                  onChange={(event) =>
                    updateField("message", event.target.value)
                  }
                  placeholder="Tell us about your situation, e.g. moving homes, switching providers, or comparing solar."
                  className="min-h-28 border-[#27272a] bg-[#111113] text-white"
                />
              </Field>
              <div className="rounded-xl border border-[#242427] bg-[#111113] p-4">
                <div className="font-medium text-zinc-100">
                  Review your details
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <Detail label="Name" value={form.name} />
                  <Detail label="Email" value={form.email} />
                  <Detail label="Phone" value={form.phone} />
                  <Detail label="Company" value={form.company} />
                  <Detail label="Address" value={form.address} />
                  <Detail label="Postcode" value={form.postcode} />
                  <Detail label="DOB" value={form.dob} />
                  <Detail label="Fuel type" value={form.fuelType} />
                  <Detail label="NMI/MIRN" value={form.nmiMirn} />
                  <Detail label="Concession" value={form.concession} />
                  <Detail label="Life support" value={form.lifeSupport} />
                  <Detail label="Move-in date" value={form.moveInDate} />
                  <Detail label="State" value={form.state} />
                  <Detail label="Retailer" value={form.retailer} />
                  <Detail label="Plan" value={form.plan} />
                  <Detail label="Monthly bill" value={form.usage} />
                </dl>
              </div>
              <label className="flex items-start gap-3 rounded-xl border border-[#242427] bg-[#111113] p-4">
                <Checkbox
                  checked={form.consent}
                  onCheckedChange={(checked) =>
                    updateField("consent", checked === true)
                  }
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium text-zinc-100">
                    Consent to contact
                  </div>
                  <div className="text-xs text-zinc-500">
                    I agree to be contacted about energy plans and offers.
                  </div>
                </div>
              </label>
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-[#34363a] bg-[#111113] text-white"
              disabled={step === 0}
              onClick={() => jumpTo(Math.max(0, step - 1))}
            >
              <ChevronLeftIcon className="size-4" /> Back
            </Button>
            {step < 3 ? (
              <Button size="sm" onClick={() => jumpTo(step + 1)}>
                Continue <ChevronRightIcon className="size-4" />
              </Button>
            ) : (
              <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
                <SendIcon className="size-4" /> Submit lead
              </Button>
            )}
          </div>
          {step === 3 && !canSubmit ? (
            <p className="mt-2 text-right text-xs text-zinc-500">
              Name, email and phone are required to submit.
            </p>
          ) : null}
        </div>
      </div>
    </CimetAiShell>
  )
}

function Field({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <label className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        {icon}
        <span>{label}</span>
        <span className="font-normal text-zinc-600">{hint}</span>
      </label>
      {children}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={value ? "text-zinc-100" : "text-zinc-600"}>
        {value || "—"}
      </dd>
    </div>
  )
}
