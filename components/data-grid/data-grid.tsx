"use client"

import { Plus } from "lucide-react"
import * as React from "react"
import { DataGridColumnHeader } from "@/components/data-grid/data-grid-column-header"
import { DataGridContextMenu } from "@/components/data-grid/data-grid-context-menu"
import { DataGridPasteDialog } from "@/components/data-grid/data-grid-paste-dialog"
import { DataGridRow } from "@/components/data-grid/data-grid-row"
import { DataGridSearch } from "@/components/data-grid/data-grid-search"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useAsRef } from "@/hooks/use-as-ref"
import type { useDataGrid } from "@/hooks/use-data-grid"
import {
  flexRender,
  getColumnBorderVisibility,
  getColumnPinningStyle,
  getRowHeightValue,
} from "@/lib/data-grid"
import { cn } from "@/lib/utils"
import type { Direction } from "@/types/data-grid"

const EMPTY_CELL_SELECTION_SET = new Set<string>()

interface DataGridProps<TData>
  extends
    Omit<ReturnType<typeof useDataGrid<TData>>, "dir">,
    Omit<React.ComponentProps<"div">, "contextMenu"> {
  dir?: Direction
  height?: number
  stretchColumns?: boolean
  enableColumnReorder?: boolean
  onColumnAdd?: () => void
  addColumnEditor?: (opts: { close: () => void }) => React.ReactNode
}

export function DataGrid<TData>({
  dataGridRef,
  headerRef,
  rowMapRef,
  footerRef,
  dir = "ltr",
  table,
  tableMeta,
  virtualTotalSize,
  virtualItems,
  measureElement,
  columns,
  columnSizeVars,
  searchState,
  searchMatchesByRow,
  activeSearchMatch,
  cellSelectionMap,
  focusedCell,
  editingCell,
  rowHeight,
  contextMenu,
  pasteDialog,
  onRowAdd: onRowAddProp,
  height = 600,
  stretchColumns = false,
  enableColumnReorder = true,
  onColumnAdd,
  addColumnEditor,
  adjustLayout = false,
  className,
  ...props
}: DataGridProps<TData>) {
  const rows = table.getRowModel().rows
  const readOnly = tableMeta?.readOnly ?? false
  const columnVisibility = table.getState().columnVisibility
  const columnPinning = table.getState().columnPinning
  const totalTableWidth = table.getTotalSize()
  const hasAddColumn = Boolean(onColumnAdd) || Boolean(addColumnEditor)
  const addColumnWidth = hasAddColumn ? 52 : 0
  const headerRowHeight = getRowHeightValue(rowHeight)
  const [addColumnOpen, setAddColumnOpen] = React.useState(false)
  const [draggedColumnId, setDraggedColumnId] = React.useState<string | null>(
    null
  )
  const [dragOverColumnId, setDragOverColumnId] = React.useState<string | null>(
    null
  )

  const onRowAddRef = useAsRef(onRowAddProp)

  const onRowAdd = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      onRowAddRef.current?.(event)
    },
    [onRowAddRef]
  )

  const onDataGridContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
    },
    []
  )

  const moveColumn = React.useCallback(
    (fromColumnId: string, toColumnId: string) => {
      if (fromColumnId === toColumnId) return

      const allColumnIds = table.getAllLeafColumns().map((column) => column.id)
      const orderedColumnIds =
        table.getState().columnOrder.length > 0
          ? [
              ...table.getState().columnOrder,
              ...allColumnIds.filter(
                (columnId) => !table.getState().columnOrder.includes(columnId)
              ),
            ]
          : allColumnIds

      const fromIndex = orderedColumnIds.indexOf(fromColumnId)
      const toIndex = orderedColumnIds.indexOf(toColumnId)

      if (fromIndex === -1 || toIndex === -1) return

      const nextOrder = [...orderedColumnIds]
      const [movedColumnId] = nextOrder.splice(fromIndex, 1)
      if (!movedColumnId) return

      nextOrder.splice(toIndex, 0, movedColumnId)
      table.setColumnOrder(nextOrder)
    },
    [table]
  )

  const onColumnDragStart = React.useCallback(
    (columnId: string, event: React.DragEvent<HTMLElement>) => {
      if (!enableColumnReorder || columnId === "select") return

      setDraggedColumnId(columnId)
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", columnId)
    },
    [enableColumnReorder]
  )

  const onColumnDragOver = React.useCallback(
    (columnId: string, event: React.DragEvent<HTMLDivElement>) => {
      if (
        !enableColumnReorder ||
        !draggedColumnId ||
        columnId === "select" ||
        columnId === draggedColumnId
      ) {
        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      setDragOverColumnId(columnId)
    },
    [draggedColumnId, enableColumnReorder]
  )

  const onColumnDrop = React.useCallback(
    (columnId: string, event: React.DragEvent<HTMLDivElement>) => {
      if (!enableColumnReorder || columnId === "select") return

      event.preventDefault()
      const fromColumnId =
        event.dataTransfer.getData("text/plain") || draggedColumnId
      if (fromColumnId) {
        moveColumn(fromColumnId, columnId)
      }
      setDraggedColumnId(null)
      setDragOverColumnId(null)
    },
    [draggedColumnId, enableColumnReorder, moveColumn]
  )

  const onColumnDragEnd = React.useCallback(() => {
    setDraggedColumnId(null)
    setDragOverColumnId(null)
  }, [])

  const onFooterCellKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onRowAddRef.current) return

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        onRowAddRef.current()
      }
    },
    [onRowAddRef]
  )

  return (
    <div
      data-slot="grid-wrapper"
      dir={dir}
      {...props}
      className={cn("relative flex w-full flex-col", className)}
    >
      {searchState && <DataGridSearch {...searchState} />}
      <DataGridContextMenu
        tableMeta={tableMeta}
        columns={columns}
        contextMenu={contextMenu}
      />
      <DataGridPasteDialog tableMeta={tableMeta} pasteDialog={pasteDialog} />
      <div
        role="grid"
        aria-label="Data grid"
        aria-rowcount={rows.length + (onRowAddProp ? 1 : 0)}
        aria-colcount={columns.length + (hasAddColumn ? 1 : 0)}
        data-slot="grid"
        tabIndex={0}
        ref={dataGridRef}
        className="relative grid overflow-auto rounded-md border select-none focus:outline-none"
        style={{
          ...columnSizeVars,
          height: `${height}px`,
        }}
        onContextMenu={onDataGridContextMenu}
      >
        <div
          role="rowgroup"
          data-slot="grid-header"
          ref={headerRef}
          className="sticky top-0 z-10 grid border-b bg-background"
        >
          {table.getHeaderGroups().map((headerGroup, rowIndex) => (
            <div
              key={headerGroup.id}
              role="row"
              aria-rowindex={rowIndex + 1}
              data-slot="grid-header-row"
              tabIndex={-1}
              className="flex"
              style={{
                width: "100%",
                minWidth: totalTableWidth + addColumnWidth,
                height: headerRowHeight,
              }}
            >
              {headerGroup.headers.map((header, colIndex) => {
                const sorting = table.getState().sorting
                const currentSort = sorting.find(
                  (sort) => sort.id === header.column.id
                )
                const isSortable = header.column.getCanSort()

                const nextHeader = headerGroup.headers[colIndex + 1]
                const isLastColumn = colIndex === headerGroup.headers.length - 1

                const { showEndBorder, showStartBorder } =
                  getColumnBorderVisibility({
                    column: header.column,
                    nextColumn: nextHeader?.column,
                    isLastColumn,
                  })

                return (
                  <div
                    key={header.id}
                    role="columnheader"
                    aria-colindex={colIndex + 1}
                    aria-sort={
                      currentSort?.desc === false
                        ? "ascending"
                        : currentSort?.desc === true
                          ? "descending"
                          : isSortable
                            ? "none"
                            : undefined
                    }
                    data-slot="grid-header-cell"
                    tabIndex={-1}
                    onDragOver={(event) =>
                      onColumnDragOver(header.column.id, event)
                    }
                    onDrop={(event) => onColumnDrop(header.column.id, event)}
                    onDragEnd={onColumnDragEnd}
                    className={cn("relative", {
                      grow:
                        stretchColumns &&
                        header.column.id !== "select" &&
                        !header.column.getIsPinned(),
                      "border-e":
                        showEndBorder && header.column.id !== "select",
                      "border-s":
                        showStartBorder && header.column.id !== "select",
                      "opacity-60": draggedColumnId === header.column.id,
                      "ring-2 ring-primary ring-inset":
                        dragOverColumnId === header.column.id,
                    })}
                    style={{
                      ...getColumnPinningStyle({ column: header.column, dir }),
                      width: `calc(var(--header-${header.id}-size) * 1px)`,
                    }}
                  >
                    {header.isPlaceholder ? null : typeof header.column
                        .columnDef.header === "function" ? (
                      <div className="flex h-full items-center px-3 py-1.5">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                      </div>
                    ) : (
                      <DataGridColumnHeader
                        header={header}
                        table={table}
                        enableColumnReorder={enableColumnReorder}
                        onColumnDragStart={onColumnDragStart}
                      />
                    )}
                  </div>
                )
              })}
              {hasAddColumn && (
                <div
                  role="columnheader"
                  aria-colindex={headerGroup.headers.length + 1}
                  data-slot="grid-add-column-header"
                  tabIndex={-1}
                  className="relative flex shrink-0 items-center justify-center border-e"
                  style={{ width: addColumnWidth }}
                >
                  {addColumnEditor ? (
                    <Popover
                      open={addColumnOpen}
                      onOpenChange={setAddColumnOpen}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="Add column"
                          className="flex size-full items-center justify-center text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus:bg-accent/40 focus:text-foreground focus:outline-none"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="bottom"
                        align="start"
                        sideOffset={8}
                        className="w-72 p-0"
                      >
                        {addColumnEditor({
                          close: () => setAddColumnOpen(false),
                        })}
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <button
                      type="button"
                      aria-label="Add column"
                      className="flex size-full items-center justify-center text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus:bg-accent/40 focus:text-foreground focus:outline-none"
                      onClick={onColumnAdd}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div
          role="rowgroup"
          data-slot="grid-body"
          className="relative grid"
          style={{
            width: "100%",
            minWidth: totalTableWidth + addColumnWidth,
            height: `${virtualTotalSize}px`,
            contain: adjustLayout ? "layout paint" : "strict",
          }}
        >
          {virtualItems.map((virtualItem) => {
            const row = rows[virtualItem.index]
            if (!row) return null

            const cellSelectionKeys =
              cellSelectionMap?.get(virtualItem.index) ??
              EMPTY_CELL_SELECTION_SET

            const searchMatchColumns =
              searchMatchesByRow?.get(virtualItem.index) ?? null
            const isActiveSearchRow =
              activeSearchMatch?.rowIndex === virtualItem.index

            return (
              <DataGridRow
                key={row.id}
                row={row}
                tableMeta={tableMeta}
                rowMapRef={rowMapRef}
                virtualItem={virtualItem}
                measureElement={measureElement}
                rowHeight={rowHeight}
                columnVisibility={columnVisibility}
                columnPinning={columnPinning}
                focusedCell={focusedCell}
                editingCell={editingCell}
                cellSelectionKeys={cellSelectionKeys}
                searchMatchColumns={searchMatchColumns}
                activeSearchMatch={isActiveSearchRow ? activeSearchMatch : null}
                dir={dir}
                adjustLayout={adjustLayout}
                stretchColumns={stretchColumns}
                trailingColumnWidth={addColumnWidth}
                readOnly={readOnly}
              />
            )
          })}
        </div>
        {!readOnly && onRowAdd && (
          <div
            role="rowgroup"
            data-slot="grid-footer"
            ref={footerRef}
            className="sticky bottom-0 z-10 grid border-t bg-background"
          >
            <div
              role="row"
              aria-rowindex={rows.length + 2}
              data-slot="grid-add-row"
              tabIndex={-1}
              className="flex"
              style={{
                width: "100%",
                minWidth: totalTableWidth + addColumnWidth,
              }}
            >
              <div
                role="gridcell"
                tabIndex={0}
                className="relative flex h-9 grow items-center bg-muted/30 transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none"
                style={{
                  width: totalTableWidth,
                  minWidth: totalTableWidth,
                }}
                onClick={onRowAdd}
                onKeyDown={onFooterCellKeyDown}
              >
                <div className="sticky start-0 flex items-center gap-2 px-3 text-muted-foreground">
                  <Plus className="size-3.5" />
                  <span className="text-sm">Add row</span>
                </div>
              </div>
              {hasAddColumn && (
                <div
                  role="gridcell"
                  aria-colindex={columns.length + 1}
                  data-slot="grid-add-column-footer-cell"
                  className="h-9 shrink-0 border-e bg-background"
                  style={{ width: addColumnWidth }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
