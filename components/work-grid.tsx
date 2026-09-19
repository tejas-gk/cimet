"use client"

import type { ColumnDef } from "@tanstack/react-table"
import {
  BarChart3Icon,
  Grid2X2Icon,
  LinkIcon,
  MailIcon,
  Maximize2Icon,
  PhoneCallIcon,
  PlusIcon,
  ShieldCheckIcon,
  Table2Icon,
  WorkflowIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { toast } from "sonner"

import { DataGrid } from "@/components/data-grid/data-grid"
import { DataGridFilterMenu } from "@/components/data-grid/data-grid-filter-menu"
import { DataGridKeyboardShortcuts } from "@/components/data-grid/data-grid-keyboard-shortcuts"
import {
  DataGridRowDetail,
  type DetailRow,
} from "@/components/data-grid/data-grid-row-detail"
import { DataGridRowHeightMenu } from "@/components/data-grid/data-grid-row-height-menu"
import { getDataGridSelectColumn } from "@/components/data-grid/data-grid-select-column"
import { DataGridSortMenu } from "@/components/data-grid/data-grid-sort-menu"
import { DataGridViewMenu } from "@/components/data-grid/data-grid-view-menu"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { useCampaigns } from "@/hooks/use-campaigns"
import { useDataGrid } from "@/hooks/use-data-grid"
import {
  type UndoRedoCellUpdate,
  useDataGridUndoRedo,
} from "@/hooks/use-data-grid-undo-redo"
import { useSheets } from "@/hooks/use-sheets"
import type { ColumnKind } from "@/lib/api-types"
import { getRowHeightValue } from "@/lib/data-grid"
import { cn } from "@/lib/utils"
import type { CellOpts } from "@/types/data-grid"

type GridItem = {
  id: string
  [key: string]: unknown
}

const columnKindLabels: Record<ColumnKind, string> = {
  "short-text": "Text",
  "long-text": "Long text",
  number: "Number",
  select: "Select",
  "multi-select": "Multi-select",
  checkbox: "Checkbox",
  date: "Date",
  url: "URL",
}

function getCellOptions(
  kind: ColumnKind,
  options?: Array<{ label: string; value: string }> | null
): CellOpts {
  if (kind === "select") return { variant: "select", options: options ?? [] }
  if (kind === "multi-select")
    return { variant: "multi-select", options: options ?? [] }
  if (kind === "number") return { variant: "number", min: 0, step: 1 }
  return { variant: kind }
}

function rowsToGridItems(
  rows: Array<{ id: string; values: Record<string, unknown> }>
) {
  return rows.map((row) => ({ id: row.id, ...row.values }))
}

function AddColumnForm({
  onAdd,
  onClose,
}: {
  onAdd: (label: string, kind: ColumnKind) => void
  onClose: () => void
}) {
  const [name, setName] = React.useState("")
  const [kind, setKind] = React.useState<ColumnKind>("short-text")
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = React.useCallback(() => {
    const label = name.trim()
    if (!label) return
    onAdd(label, kind)
  }, [name, kind, onAdd])

  return (
    <form
      className="space-y-2 p-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label className="block px-1">
        <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Name
        </span>
        <input
          ref={inputRef}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Column name"
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
      </label>
      <label className="block px-1">
        <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Type
        </span>
        <Select
          value={kind}
          onValueChange={(value) => setKind(value as ColumnKind)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(columnKindLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="flex items-center justify-end gap-2 border-t pt-2">
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          Add column
        </Button>
      </div>
    </form>
  )
}

export function WorkGrid() {
  const sheetsApi = useSheets()
  const campaignApi = useCampaigns(8)
  const [gridRows, setGridRows] = React.useState<GridItem[]>([])
  const [newSheetName, setNewSheetName] = React.useState("")
  const [renameColumnId, setRenameColumnId] = React.useState<string | null>(
    null
  )
  const [renameColumnName, setRenameColumnName] = React.useState("")
  const [detailRowId, setDetailRowId] = React.useState<string | null>(null)
  const [gridContainerSize, setGridContainerSize] = React.useState({
    width: 0,
    height: 0,
  })
  const gridContainerRef = React.useRef<HTMLDivElement>(null)

  const activeSheet = sheetsApi.activeSheet
  const activeColumns = React.useMemo(
    () => activeSheet?.columns ?? [],
    [activeSheet]
  )

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDetailRowId(null)
      setGridRows(rowsToGridItems(activeSheet?.rows.data ?? []))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [activeSheet])

  const pendingCampaigns = campaignApi.campaigns.filter(
    (campaign) => campaign.active
  ).length

  const { trackCellsUpdate, trackRowsAdd, trackRowsDelete } =
    useDataGridUndoRedo({
      data: gridRows,
      onDataChange: setGridRows,
      getRowId: (row) => String(row.id),
    })

  const openRenameDialog = React.useCallback(
    (columnKey: string) => {
      const column = activeColumns.find((item) => item.key === columnKey)
      if (!column) return
      setRenameColumnId(column.id)
      setRenameColumnName(column.label)
    },
    [activeColumns]
  )

  const columns = React.useMemo<ColumnDef<GridItem>[]>(
    () => [
      getDataGridSelectColumn<GridItem>({ enableRowMarkers: true }),
      ...activeColumns.map((column) => ({
        id: column.key,
        accessorKey: column.key,
        header: column.label,
        size: column.size,
        minSize: 80,
        enableResizing: true,
        enableHiding: true,
        enableSorting: true,
        meta: {
          label: column.label,
          cell: getCellOptions(column.kind, column.options),
        },
      })),
      {
        id: "row-details",
        header: () => (
          <span className="flex w-full justify-center">
            <Maximize2Icon className="size-3.5 text-muted-foreground" />
          </span>
        ),
        cell: ({ row }) => (
          <div className="flex w-full justify-center">
            <button
              type="button"
              aria-label="Open row details"
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus:bg-accent/40 focus:text-foreground focus:outline-none"
              onClick={(event) => {
                event.stopPropagation()
                setDetailRowId(String(row.original.id))
              }}
            >
              <Maximize2Icon className="size-3.5" />
            </button>
          </div>
        ),
        size: 48,
        minSize: 48,
        maxSize: 48,
        enableResizing: false,
        enableHiding: false,
        enableSorting: false,
        meta: { label: "Details" },
      },
    ],
    [activeColumns]
  )

  const onDataChange = React.useCallback(
    (nextRows: GridItem[]) => {
      const updates: UndoRedoCellUpdate[] = []
      const apiUpdates: Array<{
        rowId: string
        values: Record<string, unknown>
      }> = []

      for (let rowIndex = 0; rowIndex < gridRows.length; rowIndex += 1) {
        const previous = gridRows[rowIndex]
        const next = nextRows[rowIndex]
        if (!previous || !next) continue

        const values: Record<string, unknown> = {}
        for (const column of activeColumns) {
          if (!Object.is(previous[column.key], next[column.key])) {
            values[column.key] = next[column.key]
            updates.push({
              rowId: String(previous.id),
              columnId: column.key,
              previousValue: previous[column.key],
              newValue: next[column.key],
            })
          }
        }

        if (Object.keys(values).length > 0) {
          apiUpdates.push({ rowId: String(next.id), values })
        }
      }

      if (updates.length > 0) trackCellsUpdate(updates)
      setGridRows(nextRows)
      void sheetsApi.updateCells(apiUpdates).catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Could not save cells"
        )
        setGridRows(gridRows)
      })
    },
    [activeColumns, gridRows, sheetsApi, trackCellsUpdate]
  )

  const onRowAdd = React.useCallback(async () => {
    const rows = await sheetsApi.addRows(1)
    const row = rowsToGridItems(rows)[0]
    if (!row) return null
    setGridRows((current) => [...current, row])
    trackRowsAdd([row])
    return { rowIndex: gridRows.length, columnId: activeColumns[0]?.key }
  }, [activeColumns, gridRows.length, sheetsApi, trackRowsAdd])

  const onRowsAdd = React.useCallback(
    async (count: number) => {
      const rows = rowsToGridItems(await sheetsApi.addRows(count))
      setGridRows((current) => [...current, ...rows])
      trackRowsAdd(rows)
    },
    [sheetsApi, trackRowsAdd]
  )

  const onRowsDelete = React.useCallback(
    (rows: GridItem[]) => {
      const rowIds = rows.map((row) => String(row.id))
      trackRowsDelete(rows)
      setGridRows((current) =>
        current.filter((row) => !rowIds.includes(String(row.id)))
      )
      void sheetsApi.deleteRows(rowIds).catch((error) => {
        toast.error(
          error instanceof Error ? error.message : "Could not delete rows"
        )
        setGridRows((current) => [...current, ...rows])
      })
    },
    [sheetsApi, trackRowsDelete]
  )

  const dataGrid = useDataGrid({
    data: gridRows,
    columns,
    onDataChange,
    onRowAdd,
    onRowsAdd,
    onRowsDelete,
    getRowId: (row) => String(row.id),
    enableColumnSelection: true,
    enablePaste: true,
    enableSearch: true,
    enableSingleCellSelection: true,
    autoFocus: activeColumns[0]
      ? { rowIndex: 0, columnId: activeColumns[0].key }
      : false,
    meta: { onColumnRename: openRenameDialog },
  })

  React.useEffect(() => {
    dataGrid.table.getColumn("row-details")?.pin("right")
  }, [dataGrid.table])

  const detailRow = React.useMemo<DetailRow | null>(
    () => gridRows.find((row) => String(row.id) === detailRowId) ?? null,
    [gridRows, detailRowId]
  )

  const handleDetailFieldChange = React.useCallback(
    (key: string, value: unknown) => {
      if (!detailRowId) return
      const nextRows = gridRows.map((row) =>
        String(row.id) === detailRowId ? { ...row, [key]: value } : row
      )
      onDataChange(nextRows)
    },
    [detailRowId, gridRows, onDataChange]
  )

  const handleDetailDelete = React.useCallback(() => {
    if (!detailRowId) return
    const row = gridRows.find((item) => String(item.id) === detailRowId)
    setDetailRowId(null)
    if (row) onRowsDelete([row])
  }, [detailRowId, gridRows, onRowsDelete])

  React.useEffect(() => {
    const node = gridContainerRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setGridContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const rowHeightPx = getRowHeightValue(dataGrid.rowHeight)
  const totalGridWidth = dataGrid.table.getTotalSize() + 52
  const stretchColumns = gridContainerSize.width > totalGridWidth + 8
  const contentHeight = rowHeightPx + gridRows.length * rowHeightPx + 36
  const gridHeight =
    gridContainerSize.height > 0
      ? Math.max(220, Math.min(contentHeight, gridContainerSize.height))
      : 760

  async function createSheet() {
    const name = newSheetName.trim()
    if (!name) return
    await sheetsApi.createSheet(name)
    setNewSheetName("")
  }

  async function addColumn(label: string, kind: ColumnKind) {
    const column = await sheetsApi.addColumn(label, kind)
    if (column) {
      dataGrid.table.setColumnOrder((current) => [...current, column.key])
    }
  }

  async function renameColumn() {
    const label = renameColumnName.trim()
    if (!renameColumnId || !label) return
    await sheetsApi.renameColumn(renameColumnId, label)
    setRenameColumnId(null)
    setRenameColumnName("")
  }

  return (
    <SidebarProvider
      defaultOpen
      className="dark min-h-svh bg-[#080808] text-sm text-foreground"
    >
      <Sidebar
        collapsible="icon"
        className="border-[#27272a] bg-[#0d0d0f] text-zinc-100"
      >
        <SidebarHeader className="border-b border-[#27272a] p-3">
          <div className="flex h-9 items-center gap-2 rounded-md px-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-white text-black">
              <Table2Icon className="size-4" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-semibold">Outreach OS</div>
              <div className="truncate text-xs text-zinc-500">
                Dynamic workspace
              </div>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Tables" isActive asChild>
                    <Link href="/">
                      <Table2Icon />
                      <span>Tables</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="AI Voice Agent" asChild>
                    <Link href="/calls">
                      <PhoneCallIcon />
                      <span>AI Voice Agent</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="AI Quality Auditor" asChild>
                    <Link href="/auditor">
                      <ShieldCheckIcon />
                      <span>AI Quality Auditor</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="QA Dashboard" asChild>
                    <Link href="/auditor/dashboard">
                      <BarChart3Icon />
                      <span>QA Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Sheets</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {sheetsApi.sheets.map((sheet) => (
                  <SidebarMenuItem key={sheet.id}>
                    <SidebarMenuButton
                      isActive={activeSheet?.id === sheet.id}
                      onClick={() => sheetsApi.setActiveSheetId(sheet.id)}
                    >
                      <Table2Icon />
                      <span>{sheet.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
              <div className="mt-3 grid gap-2 px-2 group-data-[collapsible=icon]:hidden">
                <label className="grid gap-1 text-xs text-zinc-500">
                  New sheet name
                  <Input
                    value={newSheetName}
                    onChange={(event) => setNewSheetName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void createSheet()
                    }}
                    className="h-8 border-[#27272a] bg-[#111113] text-white"
                  />
                </label>
                <Button
                  size="sm"
                  className="justify-start"
                  disabled={!newSheetName.trim()}
                  onClick={() => void createSheet()}
                >
                  <PlusIcon className="size-4" />
                  Create sheet
                </Button>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
        </SidebarContent>
        <SidebarFooter className="border-t border-[#27272a] p-3 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Active campaigns</span>
            <span className="font-medium text-zinc-100">
              {pendingCampaigns}
            </span>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-[#080808] text-white">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#27272a] px-3 sm:px-4">
          <SidebarTrigger className="text-zinc-300 hover:bg-[#151518] hover:text-white" />
          <Separator orientation="vertical" className="h-5 bg-[#27272a]" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">
              {activeSheet?.name ?? "Tables"}
            </h1>
          </div>
          <Badge
            variant="outline"
            className="rounded-md border-[#34363a] bg-[#111113] text-xs text-zinc-300"
          >
            {sheetsApi.saving ? "Saving" : "Saved"}
          </Badge>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          {sheetsApi.loading ? (
            <div className="grid gap-3 px-7">
              <Skeleton className="h-9 bg-[#18181b]" />
              <Skeleton className="h-[760px] bg-[#111113]" />
            </div>
          ) : !activeSheet ? (
            <div className="mx-auto grid w-full max-w-md gap-3 rounded-md border border-[#27272a] bg-[#0b0b0c] p-4">
              <h2 className="text-sm font-semibold">Create your first sheet</h2>
              <label className="grid gap-1.5 text-xs font-medium text-zinc-400">
                Sheet name
                <Input
                  value={newSheetName}
                  onChange={(event) => setNewSheetName(event.target.value)}
                  className="border-[#27272a] bg-[#111113] text-white"
                />
              </label>
              <Button
                disabled={!newSheetName.trim()}
                onClick={() => void createSheet()}
              >
                Create sheet
              </Button>
            </div>
          ) : (
            <>
              <div className="flex h-9 items-center justify-between gap-2 px-7">
                <div className="flex h-9 [scrollbar-width:thin] items-end gap-1 overflow-x-auto border-t border-[#27272a] pt-1">
                  {sheetsApi.sheets.map((sheet) => (
                    <button
                      key={sheet.id}
                      type="button"
                      className={cn(
                        "h-8 min-w-28 rounded-t-md border border-b-0 border-[#27272a] px-4 text-left text-xs font-medium text-zinc-400 transition-colors hover:bg-[#151518] hover:text-white",
                        sheet.id === activeSheet.id && "bg-[#18181b] text-white"
                      )}
                      onClick={() => sheetsApi.setActiveSheetId(sheet.id)}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 [&_button]:h-8 [&_button]:border-[#27272a] [&_button]:bg-[#111113] [&_button]:text-white [&_button]:hover:bg-[#1a1a1d]">
                  <DataGridFilterMenu table={dataGrid.table} />
                  <DataGridSortMenu table={dataGrid.table} />
                  <DataGridRowHeightMenu table={dataGrid.table} />
                  <DataGridViewMenu table={dataGrid.table} />
                </div>
              </div>

              <div ref={gridContainerRef} className="min-h-0 flex-1 px-7">
                <DataGrid
                  key={activeSheet.id}
                  {...dataGrid}
                  height={gridHeight}
                  stretchColumns={stretchColumns}
                  addColumnEditor={({ close }) => (
                    <AddColumnForm
                      onAdd={(label, kind) => {
                        void addColumn(label, kind)
                          .catch((error) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Could not add column"
                            )
                          )
                          .finally(close)
                      }}
                      onClose={close}
                    />
                  )}
                  className="[&_[data-slot=grid-cell-wrapper]]:px-2.5 [&_[data-slot=grid-cell-wrapper]]:py-1 [&_[data-slot=grid-cell-wrapper]]:text-[13px] [&_[data-slot=grid-cell-wrapper]]:font-medium [&_[data-slot=grid-cell]]:border-[#252527] [&_[data-slot=grid-footer]]:border-[#27272a] [&_[data-slot=grid-footer]]:bg-[#080808] [&_[data-slot=grid-header-cell]]:border-[#27272a] [&_[data-slot=grid-header-cell]]:bg-[#080808] [&_[data-slot=grid-header]]:border-[#27272a] [&_[data-slot=grid-header]]:bg-[#080808] [&_[data-slot=grid-row]]:border-[#252527] [&_[data-slot=grid]]:rounded-md [&_[data-slot=grid]]:border-[#27272a] [&_[data-slot=grid]]:bg-[#080808] [&_[data-slot=grid]]:text-white"
                />
              </div>
            </>
          )}
        </div>
      </SidebarInset>

      {activeSheet ? (
        <DataGridKeyboardShortcuts
          enablePaste
          enableRowAdd
          enableRowsDelete
          enableSearch={!!dataGrid.searchState}
          enableUndoRedo
        />
      ) : null}

      <Dialog
        open={renameColumnId !== null}
        onOpenChange={(open) => {
          if (!open) setRenameColumnId(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename column</DialogTitle>
          </DialogHeader>
          <Input
            value={renameColumnName}
            onChange={(event) => setRenameColumnName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void renameColumn()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameColumnId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void renameColumn()}
              disabled={!renameColumnName.trim()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DataGridRowDetail
        open={detailRowId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRowId(null)
        }}
        row={detailRow}
        columns={activeColumns}
        onFieldChange={handleDetailFieldChange}
        onDelete={handleDetailDelete}
      />
    </SidebarProvider>
  )
}
