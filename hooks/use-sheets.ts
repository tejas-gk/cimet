"use client"

import * as React from "react"

import type {
  ColumnKind,
  SheetColumn,
  SheetDetail,
  SheetRow,
  SheetSummary,
} from "@/lib/api-types"

type ColumnOption = { label: string; value: string }

const COLUMN_SIZE = 200

let sequence = 0

function localId(prefix: string) {
  sequence += 1
  return `${prefix}_${Date.now().toString(36)}_${sequence}`
}

const leadStatusOptions: ColumnOption[] = [
  { label: "New", value: "new" },
  { label: "Contacted", value: "contacted" },
  { label: "Qualified", value: "qualified" },
  { label: "Unqualified", value: "unqualified" },
]

const outreachStatusOptions: ColumnOption[] = [
  { label: "Pending", value: "pending" },
  { label: "Sent", value: "sent" },
  { label: "Replied", value: "replied" },
]

const channelOptions: ColumnOption[] = [
  { label: "Email", value: "email" },
  { label: "LinkedIn", value: "linkedin" },
  { label: "Call", value: "call" },
]

const genericSelectOptions: ColumnOption[] = [
  { label: "Option A", value: "option-a" },
  { label: "Option B", value: "option-b" },
  { label: "Option C", value: "option-c" },
]

type ColumnSpec = {
  key: string
  label: string
  kind: ColumnKind
  size: number
  options?: ColumnOption[]
}

function buildSheet(
  id: string,
  name: string,
  position: number,
  columnSpecs: ColumnSpec[],
  rowsValues: Array<Record<string, unknown>>
): SheetDetail {
  const columns: SheetColumn[] = columnSpecs.map((spec, index) => ({
    id: `${id}_col_${index + 1}`,
    sheetId: id,
    key: spec.key,
    label: spec.label,
    kind: spec.kind,
    size: spec.size,
    options: spec.options ?? null,
    position: index,
  }))
  const rows: SheetRow[] = rowsValues.map((values, index) => ({
    id: `${id}_row_${index + 1}`,
    sheetId: id,
    position: index,
    values,
  }))
  return {
    id,
    name,
    position,
    columns,
    rows: {
      data: rows,
      meta: { total: rows.length, page: 1, limit: 500, pages: 1 },
    },
  }
}

const initialDetails: SheetDetail[] = [
  buildSheet(
    "sheet_leads",
    "Leads",
    0,
    [
      { key: "name", label: "Name", kind: "short-text", size: COLUMN_SIZE },
      { key: "company", label: "Company", kind: "short-text", size: COLUMN_SIZE },
      { key: "email", label: "Email", kind: "short-text", size: COLUMN_SIZE },
      { key: "status", label: "Status", kind: "select", size: COLUMN_SIZE, options: leadStatusOptions },
      { key: "value", label: "Value", kind: "number", size: COLUMN_SIZE },
    ],
    [
      { name: "Alice Johnson", company: "Acme Corp", email: "alice@acme.com", status: "new", value: 25000 },
      { name: "Bob Martinez", company: "Globex", email: "bob@globex.com", status: "contacted", value: 12000 },
      { name: "Carol Nguyen", company: "Initech", email: "carol@initech.com", status: "qualified", value: 50000 },
      { name: "Dave Patel", company: "Umbrella", email: "dave@umbrella.com", status: "unqualified", value: 8000 },
    ]
  ),
  buildSheet(
    "sheet_outreach",
    "Outreach",
    1,
    [
      { key: "contact", label: "Contact", kind: "short-text", size: COLUMN_SIZE },
      { key: "channel", label: "Channel", kind: "select", size: COLUMN_SIZE, options: channelOptions },
      { key: "status", label: "Status", kind: "select", size: COLUMN_SIZE, options: outreachStatusOptions },
    ],
    [
      { contact: "Alice Johnson", channel: "email", status: "sent" },
      { contact: "Bob Martinez", channel: "linkedin", status: "pending" },
      { contact: "Carol Nguyen", channel: "call", status: "replied" },
    ]
  ),
]

export function useSheets() {
  const [details, setDetails] = React.useState<SheetDetail[]>(initialDetails)
  const [activeSheetId, setActiveSheetIdState] = React.useState(
    initialDetails[0]?.id ?? ""
  )
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const sheets = React.useMemo<SheetSummary[]>(
    () =>
      details.map(({ id, name, position, columns, rows }) => ({
        id,
        name,
        position,
        columns,
        _count: { rows: rows.data.length },
      })),
    [details]
  )

  const activeSheet = React.useMemo(
    () => details.find((sheet) => sheet.id === activeSheetId) ?? null,
    [details, activeSheetId]
  )

  async function loadSheet(sheetId: string) {
    setActiveSheetIdState(sheetId)
    return details.find((sheet) => sheet.id === sheetId) ?? null
  }

  async function refresh() {
    setError(null)
  }

  async function createSheet(name: string) {
    const id = localId("sheet")
    setDetails((current) => [
      ...current,
      buildSheet(id, name, current.length, [], []),
    ])
    setActiveSheetIdState(id)
  }

  async function updateCells(
    updates: Array<{ rowId: string; values: Record<string, unknown> }>
  ) {
    if (updates.length === 0) return
    setSaving(true)
    await new Promise((resolve) => setTimeout(resolve, 80))
    setDetails((current) =>
      current.map((sheet) => {
        if (sheet.id !== activeSheetId) return sheet
        const valuesById = new Map(
          updates.map((update) => [update.rowId, update.values])
        )
        const data = sheet.rows.data.map((row) => {
          const values = valuesById.get(row.id)
          return values
            ? { ...row, values: { ...row.values, ...values } }
            : row
        })
        return { ...sheet, rows: { ...sheet.rows, data } }
      })
    )
    setSaving(false)
  }

  async function addRows(count: number, values?: Record<string, unknown>) {
    const sheet = details.find((item) => item.id === activeSheetId)
    if (!sheet) return []
    const startPosition = sheet.rows.data.length
    const rows: SheetRow[] = Array.from({ length: count }, (_, index) => ({
      id: localId("row"),
      sheetId: sheet.id,
      position: startPosition + index,
      values: values ?? {},
    }))
    setDetails((current) =>
      current.map((item) =>
        item.id === activeSheetId
          ? {
              ...item,
              rows: {
                ...item.rows,
                data: [...item.rows.data, ...rows],
                meta: {
                  ...item.rows.meta,
                  total: item.rows.data.length + rows.length,
                },
              },
            }
          : item
      )
    )
    return rows
  }

  async function deleteRows(rowIds: string[]) {
    if (rowIds.length === 0) return
    const idSet = new Set(rowIds)
    setDetails((current) =>
      current.map((sheet) =>
        sheet.id === activeSheetId
          ? {
              ...sheet,
              rows: {
                ...sheet.rows,
                data: sheet.rows.data.filter((row) => !idSet.has(row.id)),
              },
            }
          : sheet
      )
    )
  }

  async function addColumn(
    label: string,
    kind: ColumnKind,
    options?: ColumnOption[]
  ) {
    const sheet = details.find((item) => item.id === activeSheetId)
    if (!sheet) return null

    const baseKey =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "column"
    let key = baseKey
    let suffix = 2
    while (sheet.columns.some((column) => column.key === key)) {
      key = `${baseKey}_${suffix}`
      suffix += 1
    }

    const column: SheetColumn = {
      id: localId("column"),
      sheetId: sheet.id,
      key,
      label,
      kind,
      size: COLUMN_SIZE,
      options:
        options ??
        (kind === "select" || kind === "multi-select"
          ? genericSelectOptions
          : null),
      position: sheet.columns.length,
    }

    setDetails((current) =>
      current.map((item) =>
        item.id === sheet.id
          ? { ...item, columns: [...item.columns, column] }
          : item
      )
    )
    return column
  }

  async function renameColumn(columnId: string, label: string) {
    setDetails((current) =>
      current.map((sheet) =>
        sheet.id === activeSheetId
          ? {
              ...sheet,
              columns: sheet.columns.map((column) =>
                column.id === columnId ? { ...column, label } : column
              ),
            }
          : sheet
      )
    )
  }

  return {
    sheets,
    activeSheet,
    activeSheetId,
    loading,
    saving,
    error,
    setActiveSheetId: (sheetId: string) => void loadSheet(sheetId),
    createSheet,
    updateCells,
    addRows,
    deleteRows,
    addColumn,
    renameColumn,
    refresh,
  }
}