/**
 * Minimal 16-bit PCM WAV helpers used when composing demo call recordings.
 * All TTS output is generated at 16 kHz, mono, 16-bit PCM so buffers can be
 * concatenated losslessly.
 */

export type WavInfo = {
  sampleRate: number
  channelCount: number
  bitsPerSample: number
  pcmOffset: number
  pcmLength: number
}

export function inspectWav(buffer: Buffer): WavInfo {
  if (buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Not a RIFF/WAV file")
  }
  const sampleRate = buffer.readUInt32LE(24)
  const channelCount = buffer.readUInt16LE(22)
  const bitsPerSample = buffer.readUInt16LE(34)
  // Locate the "data" chunk (the canonical "fmt " + "data" layout is assumed,
  // but we scan so extra chunks (LIST/INFO) don't break concatenation).
  let offset = 12
  let pcmOffset = -1
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (chunkId === "data") {
      pcmOffset = offset + 8
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (pcmOffset === -1) throw new Error("WAV has no data chunk")
  return {
    sampleRate,
    channelCount,
    bitsPerSample,
    pcmOffset,
    pcmLength: buffer.length - pcmOffset,
  }
}

export function silence(sampleRate: number, seconds: number): Buffer {
  if (sampleRate % 2 !== 0)
    throw new Error("sampleRate must be even for WAV alignment")
  return buildWav(
    sampleRate,
    Buffer.alloc(Math.round(sampleRate * 2 * seconds))
  )
}

/**
 * Concatenate 16-bit PCM WAV buffers (same sample rate/channels) with silence
 * gaps between each. Returns a single valid WAV.
 */
export function concatWavs(parts: Buffer[], gapMs = 120): Buffer {
  if (parts.length === 0) throw new Error("No WAV parts to concatenate")
  const infos = parts.map(inspectWav)
  const sampleRate = infos[0].sampleRate
  for (const info of infos) {
    if (
      info.sampleRate !== sampleRate ||
      info.channelCount !== 1 ||
      info.bitsPerSample !== 16
    ) {
      throw new Error(
        "All WAV parts must be 16-bit mono PCM at the same sample rate"
      )
    }
  }

  const gapBytes = Math.round((sampleRate * 2 * gapMs) / 1000)
  const totalBytes =
    infos.reduce((sum, info) => sum + info.pcmLength, 0) +
    gapBytes * Math.max(0, parts.length - 1)

  const pcm = Buffer.alloc(totalBytes)
  let cursor = 0
  parts.forEach((part, index) => {
    const info = infos[index]
    part.copy(pcm, cursor, info.pcmOffset, info.pcmOffset + info.pcmLength)
    cursor += info.pcmLength
    if (index < parts.length - 1) {
      pcm.fill(0, cursor, cursor + gapBytes)
      cursor += gapBytes
    }
  })

  return buildWav(sampleRate, pcm)
}

export function buildWav(sampleRate: number, pcm: Buffer): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = pcm.length
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(36 + dataSize, 4)
  header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write("data", 36, "ascii")
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

export function wavDurationMs(buffer: Buffer): number {
  const info = inspectWav(buffer)
  return Math.round((info.pcmLength / (info.sampleRate * 2)) * 1000)
}

/** Convert mono 16-bit PCM samples to an approximate volume metric (0..1). */
export function pcmLevel(pcm: Buffer): number {
  if (pcm.length < 2) return 0
  let sum = 0
  let n = 0
  // Sample every 4th sample for speed.
  for (let i = 0; i + 1 < pcm.length; i += 4) {
    sum += Math.abs(pcm.readInt16LE(i))
    n += 1
  }
  if (n === 0) return 0
  return Math.min(1, sum / n / 32767)
}

/**
 * Trim leading/trailing silence from a 16-bit mono PCM WAV so concatenated
 * demo recordings stay short enough for synchronous STT (Sarvam's limit is
 * ~30s). The first/last speech frame is kept with a small padding margin.
 */
export function trimWav(buffer: Buffer, threshold = 0.015, padMs = 40): Buffer {
  const info = inspectWav(buffer)
  const bytesPerSample = info.bitsPerSample / 8
  const winBytes = bytesPerSample * Math.round((info.sampleRate * 10) / 1000)
  const frameCount = Math.floor(info.pcmLength / winBytes)
  if (frameCount <= 1) return buffer

  const frames: number[] = []
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0
    const base = info.pcmOffset + frame * winBytes
    for (let i = 0; i < winBytes; i += bytesPerSample) {
      sum += Math.abs(buffer.readInt16LE(base + i))
    }
    frames.push(sum / (winBytes / bytesPerSample) / 32767)
  }

  let startFrame = frameCount
  let endFrame = -1
  for (let f = 0; f < frameCount; f++) {
    if (frames[f] >= threshold) {
      startFrame = f
      break
    }
  }
  for (let f = frameCount - 1; f >= 0; f--) {
    if (frames[f] >= threshold) {
      endFrame = f
      break
    }
  }
  if (endFrame < startFrame) return buffer

  const padBytes = Math.round((info.sampleRate * bytesPerSample * padMs) / 1000)
  const startByte = Math.max(
    info.pcmOffset,
    info.pcmOffset + startFrame * winBytes - padBytes
  )
  const endByte = Math.min(
    buffer.length,
    info.pcmOffset + (endFrame + 1) * winBytes + padBytes
  )
  const pcm = buffer.subarray(startByte, endByte)
  return buildWav(info.sampleRate, pcm)
}
