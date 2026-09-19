/** Small server-side helpers for Route Handlers. */

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}

export function apiError(
  message: string,
  status = 400,
  code = "bad_request"
): Response {
  return json({ error: { message, code } }, { status })
}

export function handle<T extends (...args: never[]) => Promise<Response>>(
  fn: T
): T {
  const wrapped = async (...args: Parameters<T>): Promise<Response> => {
    try {
      return await fn(...args)
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
      ) {
        const err = error as { message: string; code: string }
        return apiError(err.message, 400, err.code)
      }
      const message =
        error instanceof Error ? error.message : "Internal server error"
      console.error("[cimet-ai] Unhandled route error:", error)
      return apiError(message, 500, "internal_error")
    }
  }
  return wrapped as T
}
