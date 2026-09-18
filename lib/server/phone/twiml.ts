function attrs(values: Record<string, string | undefined>) {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("")
}

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

export function response(children: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${children}</Response>`
}

export function play(url: string) {
  return `<Play>${escapeXml(url)}</Play>`
}

export function say(text: string) {
  return `<Say voice="alice">${escapeXml(text)}</Say>`
}

export function gather(action: string, children = "") {
  return `<Gather${attrs({ input: "speech", action, method: "POST", speechTimeout: "auto", timeout: "8" })}>${children}</Gather>`
}

export function hangup() {
  return "<Hangup/>"
}
