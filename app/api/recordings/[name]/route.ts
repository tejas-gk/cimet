import fs from "node:fs"
import path from "node:path"

import { recordingsDir } from "@/lib/server/auditor"
import { handle, apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SAFE_NAME = /^[A-Za-z0-9._-]+$/

export const GET = handle(
  async (_req: Request, ctx: RouteContext<"/api/recordings/[name]">) => {
    const { name } = await ctx.params
    if (!SAFE_NAME.test(name)) {
      return apiError("Invalid recording name", 400, "invalid_name")
    }
    const filePath = path.join(recordingsDir(), name)
    if (!fs.existsSync(filePath)) {
      return apiError("Recording not found", 404, "not_found")
    }
    const data = fs.readFileSync(filePath)
    const contentType = name.toLowerCase().endsWith(".mp3")
      ? "audio/mpeg"
      : "audio/wav"
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(data.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  }
)
