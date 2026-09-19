"use client"

import type {
  CellContext,
  ColumnDef,
  HeaderContext,
} from "@tanstack/react-table"
import { LanguagesIcon } from "lucide-react"
import { Inter } from "next/font/google"
import * as React from "react"

import { DataGrid } from "@/components/data-grid/data-grid"
import { DataGridCellWrapper } from "@/components/data-grid/data-grid-cell-wrapper"
import { DataGridColumnHeader } from "@/components/data-grid/data-grid-column-header"
import { DataGridFilterMenu } from "@/components/data-grid/data-grid-filter-menu"
import { DataGridKeyboardShortcuts } from "@/components/data-grid/data-grid-keyboard-shortcuts"
import { DataGridRowHeightMenu } from "@/components/data-grid/data-grid-row-height-menu"
import { getDataGridSelectColumn } from "@/components/data-grid/data-grid-select-column"
import { DataGridSortMenu } from "@/components/data-grid/data-grid-sort-menu"
import { DataGridViewMenu } from "@/components/data-grid/data-grid-view-menu"
import { Button } from "@/components/ui/button"
import { useDataGrid } from "@/hooks/use-data-grid"
import {
  useDataGridUndoRedo,
  type UndoRedoCellUpdate,
} from "@/hooks/use-data-grid-undo-redo"
import { getFilterFn } from "@/lib/data-grid-filters"
import {
  ENERGY_PLANS,
  ENERGY_STATES,
  RETAILERS,
  emptyLead,
  leadProgress,
  type Lead,
} from "@/lib/leads-store"
import type { CellOpts } from "@/types/data-grid"
import styles from "./leads-data-grid.module.css"

const inter = Inter({ subsets: ["latin"], display: "swap" })
const editableFields = [
  "email",
  "phone",
  "company",
  "state",
  "retailer",
  "plan",
  "message",
] as const
const getRowId = (lead: Lead) => lead.id
const qaLabels = {
  pending: "Pending",
  "auto-pass": "Pass",
  hold: "Hold",
  "human-review": "Review",
}

interface LeadsDataGridProps {
  leads: Lead[]
  onUpdate: (patch: Partial<Lead> & { id: string }) => void
  onOpen: (id: string) => void
  renderActions: (lead: Lead) => React.ReactNode
}

// Actions must receive fresh call/provider state even when the virtualized row is memoized.
const LeadActionsContext = React.createContext<Pick<
  LeadsDataGridProps,
  "onOpen" | "renderActions"
> | null>(null)

function LeadName({ lead }: { lead: Lead }) {
  const actions = React.useContext(LeadActionsContext)
  return (
    <button
      type="button"
      className="block w-full truncate text-start outline-none hover:underline focus-visible:underline"
      onClick={() => actions?.onOpen(lead.id)}
      aria-label={`Open details for ${lead.name || "Unnamed lead"}`}
    >
      {lead.name || "Unnamed lead"}
    </button>
  )
}

function LeadActions({ lead }: { lead: Lead }) {
  const actions = React.useContext(LeadActionsContext)
  return actions?.renderActions(lead)
}

function ReadOnlyCell({
  cell,
  row,
  table,
  children,
}: CellContext<Lead, unknown> & { children: React.ReactNode }) {
  const meta = table.options.meta
  const rowIndex = (meta?.getVisualRowIndex?.(row.id) ?? row.index + 1) - 1
  const columnId = cell.column.id
  return (
    <DataGridCellWrapper
      cell={cell}
      tableMeta={{ ...meta, onCellDoubleClick: meta?.onCellClick }}
      rowIndex={rowIndex}
      columnId={columnId}
      rowHeight={meta?.rowHeight ?? "short"}
      isFocused={
        meta?.focusedCell?.rowIndex === rowIndex &&
        meta?.focusedCell?.columnId === columnId
      }
      isEditing={false}
      isSelected={meta?.getIsCellSelected?.(rowIndex, columnId) ?? false}
      isSearchMatch={meta?.getIsSearchMatch?.(rowIndex, columnId) ?? false}
      isActiveSearchMatch={
        meta?.getIsActiveSearchMatch?.(rowIndex, columnId) ?? false
      }
      readOnly
    >
      {children}
    </DataGridCellWrapper>
  )
}

function ReadOnlyHeader({ header, table }: HeaderContext<Lead, unknown>) {
  return (
    <DataGridColumnHeader header={header} table={table} className="size-full" />
  )
}

const filterFn = getFilterFn<Lead>()
function textColumn(
  id: (typeof editableFields)[number],
  label: string,
  size: number,
  cell: CellOpts = { variant: "short-text" }
): ColumnDef<Lead> {
  return {
    id,
    accessorKey: id,
    header: label,
    size,
    filterFn,
    meta: { label, cell },
  }
}
const options = (values: string[]) =>
  values.map((value) => ({ label: value, value }))

export function LeadsDataGrid({
  leads,
  onUpdate,
  onOpen,
  renderActions,
}: LeadsDataGridProps) {
  const [dir, setDir] = React.useState<"ltr" | "rtl">("ltr")
  const columns = React.useMemo<ColumnDef<Lead>[]>(
    () => [
      getDataGridSelectColumn<Lead>({
        size: 60,
        enableRowMarkers: true,
        enablePinning: false,
      }),
      {
        id: "name",
        accessorKey: "name",
        header: ReadOnlyHeader,
        cell: ({ row }) => <LeadName lead={row.original} />,
        size: 180,
        filterFn,
        meta: { label: "Name", cell: { variant: "short-text" } },
      },
      textColumn("email", "Email", 240),
      textColumn("phone", "Phone", 180),
      textColumn("company", "Company", 200),
      textColumn("plan", "Plan", 200, {
        variant: "select",
        options: options(ENERGY_PLANS),
      }),
      textColumn("retailer", "Retailer", 180, {
        variant: "select",
        options: options(RETAILERS),
      }),
      textColumn("state", "State", 100, {
        variant: "select",
        options: options(ENERGY_STATES),
      }),
      {
        id: "status",
        accessorFn: (lead) => (lead.submitted ? "Submitted" : "Draft"),
        header: ReadOnlyHeader,
        cell: ({ getValue }) => (
          <span className={styles.tag}>{getValue<string>()}</span>
        ),
        size: 130,
        filterFn,
        meta: {
          label: "Status",
          cell: { variant: "select", options: options(["Submitted", "Draft"]) },
        },
      },
      {
        id: "progress",
        accessorFn: leadProgress,
        header: ReadOnlyHeader,
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue<number>()}%</span>
        ),
        size: 110,
        filterFn,
        meta: { label: "Progress", cell: { variant: "number" } },
      },
      {
        id: "recording",
        accessorFn: (lead) =>
          lead.recordingUrl && lead.transcript.length ? "Transcribed" : "None",
        header: ReadOnlyHeader,
        cell: ({ getValue }) => (
          <span
            className={
              getValue() === "None" ? "text-muted-foreground" : styles.tag
            }
          >
            {getValue<string>()}
          </span>
        ),
        size: 140,
        filterFn,
        meta: {
          label: "Recording",
          cell: {
            variant: "select",
            options: options(["Transcribed", "None"]),
          },
        },
      },
      {
        id: "qaStatus",
        accessorKey: "qaStatus",
        header: ReadOnlyHeader,
        cell: ({ row }) => (
          <span className={styles.tag}>{qaLabels[row.original.qaStatus]}</span>
        ),
        size: 150,
        filterFn,
        meta: {
          label: "Quality audit",
          cell: {
            variant: "select",
            options: Object.entries(qaLabels).map(([value, label]) => ({
              value,
              label,
            })),
          },
        },
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: ReadOnlyHeader,
        cell: ({ row }) => (
          <span title={new Date(row.original.updatedAt).toLocaleString()}>
            {new Date(row.original.updatedAt).toLocaleDateString()}
          </span>
        ),
        size: 150,
        filterFn,
        meta: { label: "Updated", cell: { variant: "date" } },
      },
      textColumn("message", "Notes", 240, { variant: "long-text" }),
      {
        id: "actions",
        header: () => <span className="text-sm">Actions</span>,
        cell: ({ row }) => <LeadActions lead={row.original} />,
        size: 290,
        enableHiding: false,
        enableSorting: false,
        enableColumnFilter: false,
        enableResizing: false,
      },
    ],
    []
  )

  const gridColumns = React.useMemo(
    () =>
      columns.map((column) => {
        if (
          column.id === "select" ||
          column.id === "actions" ||
          typeof column.cell !== "function"
        )
          return column
        const renderCell = column.cell
        return {
          ...column,
          cell: (context: CellContext<Lead, unknown>) => (
            <ReadOnlyCell {...context}>{renderCell(context)}</ReadOnlyCell>
          ),
        }
      }),
    [columns]
  )

  const gridHostRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const host = gridHostRef.current
    if (!host) return
    const resize = () =>
      host.style.setProperty(
        "--leads-grid-height",
        `${Math.max(360, window.innerHeight - host.getBoundingClientRect().top - 24)}px`
      )
    resize()
    const observer = new ResizeObserver(resize)
    if (host.parentElement?.parentElement)
      observer.observe(host.parentElement.parentElement)
    window.addEventListener("resize", resize)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", resize)
    }
  }, [])

  const persistChanges = React.useCallback(
    (next: Lead[]) => {
      const currentById = new Map(leads.map((lead) => [lead.id, lead]))
      for (const lead of next) {
        const previous = currentById.get(lead.id)
        if (!previous || previous === lead) continue
        const patch: Partial<Lead> & { id: string } = { id: lead.id }
        for (const key of editableFields) {
          if (lead[key] !== previous[key]) patch[key] = String(lead[key] ?? "")
        }
        if (Object.keys(patch).length > 1) onUpdate(patch)
      }
    },
    [leads, onUpdate]
  )

  const { trackCellsUpdate } = useDataGridUndoRedo({
    data: leads,
    onDataChange: persistChanges,
    getRowId,
  })
  const onDataChange = React.useCallback(
    (next: Lead[]) => {
      const currentById = new Map(leads.map((lead) => [lead.id, lead]))
      const updates: UndoRedoCellUpdate[] = []
      for (const lead of next) {
        const previous = currentById.get(lead.id)
        if (!previous || previous === lead) continue
        for (const key of editableFields) {
          if (lead[key] !== previous[key])
            updates.push({
              rowId: lead.id,
              columnId: key,
              previousValue: previous[key],
              newValue: lead[key],
            })
        }
      }
      if (updates.length) trackCellsUpdate(updates)
      persistChanges(next)
    },
    [leads, persistChanges, trackCellsUpdate]
  )

  const onRowAdd = React.useCallback(() => {
    const lead = emptyLead()
    onUpdate(lead)
    onOpen(lead.id)
    return null
  }, [onUpdate, onOpen])

  const { table, ...gridProps } = useDataGrid({
    data: leads,
    columns: gridColumns,
    getRowId,
    onDataChange,
    onRowAdd,
    enableSearch: true,
    enablePaste: true,
    autoFocus: false,
    dir,
  })
  const actionContext = React.useMemo(
    () => ({ onOpen, renderActions }),
    [onOpen, renderActions]
  )
  const visibleCount = table.getRowModel().rows.length

  return (
    <LeadActionsContext.Provider value={actionContext}>
      <section
        aria-label="Leads table"
        className={`${styles.root} ${inter.className}`}
      >
        <div
          role="toolbar"
          aria-label="Grid controls"
          aria-orientation="horizontal"
          className={styles.toolbar}
        >
          <Button
            variant="outline"
            size="sm"
            aria-label={`Switch to ${dir === "ltr" ? "right-to-left" : "left-to-right"} layout`}
            onClick={() => setDir(dir === "ltr" ? "rtl" : "ltr")}
          >
            <LanguagesIcon className="text-muted-foreground" />
            {dir.toUpperCase()}
          </Button>
          <DataGridFilterMenu table={table} />
          <DataGridSortMenu table={table} />
          <DataGridRowHeightMenu table={table} />
          <DataGridViewMenu table={table} />
        </div>
        <DataGridKeyboardShortcuts
          enableSearch
          enablePaste
          enableUndoRedo
          enableRowAdd
        />
        <div ref={gridHostRef} className="relative min-w-0">
          <DataGrid
            table={table}
            {...gridProps}
            enableColumnReorder={false}
            className={styles.grid}
          />
          {visibleCount === 0 && (
            <div
              className="pointer-events-none absolute inset-x-0 top-20 flex flex-col items-center gap-2 px-6 text-center text-sm text-muted-foreground"
              role="status"
            >
              <span>
                {leads.length
                  ? "No leads match your filters."
                  : "No leads yet. Add a row or create a new lead to get started."}
              </span>
              {leads.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="pointer-events-auto"
                  onClick={() => table.resetColumnFilters()}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
    </LeadActionsContext.Provider>
  )
}
