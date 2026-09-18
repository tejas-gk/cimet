"use client"

import {
  BarChart3Icon,
  BotIcon,
  ClipboardPlusIcon,
  LayoutGridIcon,
  PhoneCallIcon,
  ShieldCheckIcon,
  SunIcon,
  UsersIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
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
  SidebarTrigger,
} from "@/components/ui/sidebar"

const navItems = [
  { href: "/", label: "Workspace", icon: LayoutGridIcon },
  { href: "/calls", label: "AI Voice Agent", icon: PhoneCallIcon },
  { href: "/solar", label: "Solar Sales Agent", icon: SunIcon },
  { href: "/auditor", label: "AI Quality Auditor", icon: ShieldCheckIcon },
  { href: "/auditor/dashboard", label: "QA Dashboard", icon: BarChart3Icon },
]

const leadNavItems = [
  { href: "/lead-form", label: "Lead Form", icon: ClipboardPlusIcon },
  { href: "/leads", label: "Leads", icon: UsersIcon },
]

export function CimetAiShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

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
              <BotIcon className="size-4" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-semibold">CIMET AI Ops</div>
              <div className="truncate text-xs text-zinc-500">
                Voice + Quality automation
              </div>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : item.href === "/auditor"
                        ? pathname === "/auditor" ||
                          /^\/auditor\/[^/]+$/.test(pathname)
                        : pathname.startsWith(item.href)
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        tooltip={item.label}
                        isActive={isActive}
                        asChild
                      >
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Lead capture</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {leadNavItems.map((item) => {
                  const isActive =
                    item.href === "/lead-form"
                      ? pathname === "/lead-form"
                      : pathname.startsWith(item.href)
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        tooltip={item.label}
                        isActive={isActive}
                        asChild
                      >
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Live providers</SidebarGroupLabel>
            <SidebarGroupContent className="space-y-2 px-2 text-xs text-zinc-400">
              <div className="rounded-md border border-[#242427] bg-[#111113] p-2">
                <div className="mb-1 font-medium text-zinc-100">
                  Sarvam AI (production)
                </div>
                <div>Voice TTS: bulbul:v3</div>
                <div>Voice STT: saaras:v3</div>
                <div>LLM: sarvam-105b-conversations</div>
              </div>
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              >
                Real model providers active
              </Badge>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 bg-[#080808] text-white">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#27272a] px-3 sm:px-4">
          <SidebarTrigger className="text-zinc-300 hover:bg-[#151518] hover:text-white" />
          <Separator orientation="vertical" className="h-5 bg-[#27272a]" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">
              CIMET AI automation console
            </h1>
          </div>
          <Badge
            variant="outline"
            className="rounded-md border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-300"
          >
            Live · Sarvam AI
          </Badge>
        </div>
        <main className="min-h-0 flex-1 p-4 sm:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
