import { PlusIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

function HumanAgentRow({
    agent,
    onUpdate,
    onDelete,
}: {
    agent: {
        id: string
        name: string
        role: string
        status: string
        maxConcurrent: number
        activeHandoffs: number
    }
    onUpdate: () => void
    onDelete: () => void
}) {
    const [status, setStatus] = React.useState(agent.status)

    return (
        <div className="grid grid-cols-6 items-center gap-4 border-b border-[#27272a] p-3">
            <div className="font-medium">{agent.name}</div>
            <div>{agent.role}</div>
            <div>
                <Select
                    value={status}
                    onValueChange={async (v) => {
                        setStatus(v)
                        try {
                            await fetch("/api/agents", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: agent.id, status: v }),
                            })
                            onUpdate()
                        } catch {}
                    }}
                >
                    <SelectTrigger className="h-7 w-24 border-[#34363a] bg-[#111113] text-white">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="away">Away</SelectItem>
                        <SelectItem value="busy">Busy</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div>{agent.maxConcurrent}</div>
            <div>{agent.activeHandoffs}</div>
            <div className="text-right">
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-red-400 hover:text-red-300"
                    onClick={async () => {
                        try {
                            await fetch("/api/agents", {
                                method: "DELETE",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: agent.id }),
                            })
                            onDelete()
                        } catch {}
                    }}
                >
                    Remove
                </Button>
            </div>
        </div>
    )
}

export default function AgentsPage() {
    const [agents, setAgents] = React.useState<
        Array<{
            id: string
            name: string
            role: string
            status: string
            maxConcurrent: number
            activeHandoffs: number
        }>
    >([])
    const [name, setName] = React.useState("")
    const [role, setRole] = React.useState("")
    const [maxConcurrent, setMaxConcurrent] = React.useState("1")
    const [busy, setBusy] = React.useState(false)

    const fetchAgents = React.useCallback(async () => {
        try {
            const res = await fetch("/api/agents")
            const data = await res.json()
            setAgents((data.data as Array<{ id: string; name: string; role: string; status: string; maxConcurrent: number; activeHandoffs: number }>) ?? [])
        } catch {}
    }, [])

    React.useEffect(() => {
        void fetchAgents()
    }, [fetchAgents])

    const handleCreate = async () => {
        if (!name.trim() || !role.trim()) return
        setBusy(true)
        try {
            await fetch("/api/agents/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: `agent-${crypto.randomUUID().slice(0, 8)}`,
                    name: name.trim(),
                    role: role.trim(),
                    maxConcurrent: Math.max(1, parseInt(maxConcurrent) ?? 1),
                }),
            })
            setName("")
            setRole("")
            setMaxConcurrent("1")
            void fetchAgents()
        } catch {}
        finally {
            setBusy(false)
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await fetch("/api/agents", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            })
            void fetchAgents()
        } catch {}
    }

    return (
        <div className="mx-auto grid max-w-4xl gap-5 p-6">
            <div>
                <h1 className="text-xl font-semibold">
                    Human Agents
                </h1>
                <p className="mt-0.5 text-xs text-zinc-500">
                    Add as many human agents as you need. They are not seeded.
                </p>
            </div>

            {/* Create form */}
            <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-4">
                <h2 className="mb-3 text-sm font-medium text-zinc-400">
                    Add Agent
                </h2>
                <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                        placeholder="Agent name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="border-[#34363a] bg-[#111113] text-white"
                    />
                    <Input
                        placeholder="Role (e.g. Team Lead)"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="border-[#34363a] bg-[#111113] text-white"
                    />
                    <div className="flex gap-2">
                        <Select
                            value={maxConcurrent}
                            onValueChange={setMaxConcurrent}
                        >
                            <SelectTrigger className="border-[#34363a] bg-[#111113] text-white">
                                <SelectValue placeholder="Max calls" />
                            </SelectTrigger>
                            <SelectContent>
                                {[1, 2, 3, 4, 5].map((n) => (
                                    <SelectItem key={n} value={String(n)}>
                                        {n} concurrent
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            size="sm"
                            onClick={() => void handleCreate()}
                            disabled={
                                busy || !name.trim() || !role.trim()
                            }
                        >
                            <PlusIcon className="size-4" />
                            Add
                        </Button>
                    </div>
                </div>
            </div>

            {/* Agent list */}
            <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f]">
                <div className="grid grid-cols-6 gap-4 border-b border-[#27272a] px-3 py-2 text-xs font-medium text-zinc-500">
                    <div>Name</div>
                    <div>Role</div>
                    <div>Status</div>
                    <div>Max Calls</div>
                    <div>Active</div>
                    <div className="text-right">Actions</div>
                </div>
                {agents.length === 0 ? (
                    <div className="p-6 text-center text-sm text-zinc-500">
                        No agents configured yet. Add one above.
                    </div>
                ) : (
                    agents.map((agent) => (
                        <HumanAgentRow
                            key={agent.id}
                            agent={agent}
                            onUpdate={fetchAgents}
                            onDelete={() => handleDelete(agent.id)}
                        />
                    ))
                )}
            </div>
        </div>
    )
}