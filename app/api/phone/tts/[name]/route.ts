import fs from "node:fs"

import { apiError } from "@/lib/server/http"
import { phoneTtsPath } from "@/lib/server/phone/audio"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params
  const filePath = phoneTtsPath(name)
  if (!filePath || !fs.existsSync(filePath))
    return apiError("Audio not found", 404, "not_found")
  return new Response(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    },
  })
}
