import { apiError } from "@/lib/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = async () =>
  apiError(
    "Demo data generation is disabled; complete a real call or upload a recording.",
    410,
    "disabled"
  )
