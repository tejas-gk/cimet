export type PageMeta = {
  total: number
  page: number
  limit: number
  pages: number
}

export type PaginatedResponse<T> = {
  data: T[]
  meta: PageMeta
}

export type ColumnKind =
  | "short-text"
  | "long-text"
  | "number"
  | "select"
  | "multi-select"
  | "checkbox"
  | "date"
  | "url"

export type SheetColumn = {
  id: string
  sheetId: string
  key: string
  label: string
  kind: ColumnKind
  size: number
  options?: Array<{ label: string; value: string }> | null
  position: number
}

export type SheetRow = {
  id: string
  sheetId: string
  position: number
  values: Record<string, unknown>
}

export type SheetSummary = {
  id: string
  name: string
  position: number
  columns: SheetColumn[]
  _count: { rows: number }
}

export type SheetDetail = {
  id: string
  name: string
  position: number
  columns: SheetColumn[]
  rows: PaginatedResponse<SheetRow>
}

export type Lead = {
  id: string
  company: string
  contact: string
  email: string
  title?: string | null
  status: string
}

export type QueueItem = {
  id: string
  step: string
  status: "pending" | "sending" | "sent" | "failed"
  lastError?: string | null
  scheduledAt?: string
  sentAt?: string | null
  lead: Lead
}

export type CampaignSummary = {
  id: string
  name: string
  active: boolean
  replyRate: string
  sendIntervalMin: number
  sequences: Array<{ id: string; subject: string; body: string }>
  queue: Array<{ status: string }>
}

export type CampaignDetail = Omit<CampaignSummary, "queue"> & {
  queue: PaginatedResponse<QueueItem>
}

export type ConnectedAccount = {
  id: string
  provider: string
  email: string
  status: string
  dailyLimit: number
  sentToday: number
}

export type WorkflowNode = {
  id: string
  workflowId: string
  name: string
  app: string
  color: string
  x: number
  y: number
  status: string
  description: string
}

export type WorkflowEdge = {
  id: string
  workflowId: string
  fromId: string
  toId: string
}

export type WorkflowRun = {
  id: string
  workflowId: string
  status: string
  events: Array<{ node: string; nodeId: string; status: string; time: string }>
  createdAt: string
}

export type WorkflowSummary = {
  id: string
  name: string
  active: boolean
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  runs: WorkflowRun[]
}

export type WorkflowDetail = {
  id: string
  name: string
  active: boolean
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  runs: WorkflowRun[]
}
