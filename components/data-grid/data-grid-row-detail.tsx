"use client"

import { Info, Trash2 } from "lucide-react"
import * as React from "react"
import { getColumnVariant } from "@/lib/data-grid"
import type { SheetColumn } from "@/lib/api-types"
import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"

export type DetailRow = {
  id: string
  [key: string]: unknown
}

interface DataGridRowDetailProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: DetailRow | null
  columns: SheetColumn[]
  onFieldChange: (key: string, value: unknown) => void
  onDelete: (rowId: string) => void
}

const NO_VALUE = "__none__"

export function DataGridRowDetail({
  open,
  onOpenChange,
  row,
  columns,
  onFieldChange,
  onDelete,
}: DataGridRowDetailProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex max-w-md flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Info className="size-4" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate">Row details</SheetTitle>
              <SheetDescription>
                {row ? `ID ${row.id.slice(0, 8)}` : "No row selected"}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {row ? (
            <div key={row.id} className="space-y-5">
              {columns.map((column) => (
                <RowField
                  key={column.id}
                  column={column}
                  value={row[column.key]}
                  onChange={(value) => onFieldChange(column.key, value)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No row selected.</p>
          )}
        </div>

        <SheetFooter className="border-t p-5">
          <Button
            variant="destructive"
            className="w-full"
            disabled={!row}
            onClick={() => {
              if (row) onDelete(row.id)
            }}
          >
            <Trash2 />
            Delete row
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function RowField({
  column,
  value,
  onChange,
}: {
  column: SheetColumn
  value: unknown
  onChange: (value: unknown) => void
}) {
  const variant = getColumnVariant(column.kind === "select" ? "select" : column.kind)
  const TypeIcon = variant?.icon
  const options = column.options ?? []

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {TypeIcon ? <TypeIcon className="size-3.5" /> : null}
        <span>{column.label}</span>
      </div>
      {column.kind === "multi-select" ? (
        <MultiSelectEditor value={value} options={options} onChange={onChange} />
      ) : column.kind === "select" ? (
        <Select value={typeof value === "string" ? value : ""} onValueChange={(next) => onChange(next === NO_VALUE ? null : next)}>
          <SelectTrigger>
            <SelectValue placeholder="No value" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_VALUE}>No value</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : column.kind === "number" ? (
        <Input
          type="number"
          defaultValue={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
      ) : column.kind === "long-text" ? (
        <Textarea
          defaultValue={value == null ? "" : String(value)}
          rows={4}
          className="resize-none"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : column.kind === "checkbox" ? (
        <Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(Boolean(checked))} />
      ) : column.kind === "url" ? (
        <Input
          type="url"
          defaultValue={value == null ? "" : String(value)}
          placeholder="https://…"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : column.kind === "date" ? (
        <Input
          type="date"
          defaultValue={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          defaultValue={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}

function MultiSelectEditor({
  value,
  options,
  onChange,
}: {
  value: unknown
  options: Array<{ label: string; value: string }>
  onChange: (value: unknown) => void
}) {
  const selected = React.useMemo(() => {
    const list = Array.isArray(value) ? value : value == null || value === "" ? [] : [value]
    return new Set(list.map((item) => String(item)))
  }, [value])

  const toggle = React.useCallback(
    (optionValue: string) => {
      const next = new Set(selected)
      if (next.has(optionValue)) next.delete(optionValue)
      else next.add(optionValue)
      onChange(Array.from(next))
    },
    [selected, onChange]
  )

  return (
    <div className={cn("flex flex-wrap gap-1.5", options.length === 0 && "py-1.5")}>
      {options.length === 0 ? (
        <span className="text-sm text-muted-foreground">No options</span>
      ) : (
        options.map((option) => (
          <Badge
            key={option.value}
            variant="outline"
            role="button"
            tabIndex={0}
            className={cn(
              "cursor-pointer transition-colors hover:bg-accent/40",
              selected.has(option.value) && "border-primary bg-primary/10 text-primary"
            )}
            onClick={() => toggle(option.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                toggle(option.value)
              }
            }}
          >
            {selected.has(option.value) ? "• " : "+ "}
            {option.label}
          </Badge>
        ))
      )}
    </div>
  )
}