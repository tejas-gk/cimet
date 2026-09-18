import fs from "node:fs"
import path from "node:path"

const AUDIO_DIR = path.join(process.cwd(), "data", "phone-tts")

export function phoneTtsDir() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  return AUDIO_DIR
}

export function savePhoneTtsAudio(
  callId: string,
  audioBase64: string | null | undefined
): string | null {
  if (!audioBase64) return null
  const id = crypto.randomUUID()
  const filename = `${callId}-${id}.wav`
  fs.writeFileSync(
    path.join(phoneTtsDir(), filename),
    Buffer.from(audioBase64, "base64")
  )
  return filename
}

export function phoneTtsPath(name: string): string | null {
  const safeName = path.basename(name)
  if (!safeName || safeName !== name) return null
  return path.join(phoneTtsDir(), safeName)
}
