/**
 * Legacy demo fixtures have been removed — the AI projects now run against the
 * real Sarvam pipelines. Only shared formatting helpers remain.
 */

export function formatMs(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}