"use client"

import * as React from "react"

/**
 * Browser microphone recorder that returns a 16kHz mono 16-bit WAV encoded as
 * base64. Uses MediaRecorder + OfflineAudioContext resampling so it works in
 * Chrome, Safari and Firefox (webkitAudioContext handled internally).
 */

export function audioSrc(base64: string, mime = "audio/wav"): string {
  return `data:${mime};base64,${base64}`
}

export function useVoiceRecorder() {
  const streamRef = React.useRef<MediaStream | null>(null)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const analyserRef = React.useRef<AnalyserNode | null>(null)
  const dataRef = React.useRef<Uint8Array<ArrayBuffer> | null>(null)
  const startedAtRef = React.useRef<number>(0)
  const rafRef = React.useRef<number | null>(null)
  const playingRef = React.useRef<HTMLAudioElement | null>(null)
  const [recording, setRecording] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [supported] = React.useState(
    typeof window !== "undefined" && !!(window.MediaRecorder && window.AudioContext)
  )
  const [level, setLevel] = React.useState(0)
  const [durationMs, setDurationMs] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  const start = React.useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const context = new Ctx()
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        analyserRef.current = analyser
        dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
      } catch {
        analyserRef.current = null
      }

      startedAtRef.current = Date.now()
      recorder.start(250)
      let lastTick = 0
      const tick = () => {
        const now = Date.now()
        if (now - lastTick >= 120) {
          lastTick = now
          setDurationMs(now - startedAtRef.current)
          if (analyserRef.current && dataRef.current) {
            analyserRef.current.getByteFrequencyData(dataRef.current)
            const sum = dataRef.current.reduce((a, b) => a + b, 0)
            const avg = sum / dataRef.current.length / 255
            setLevel(Math.min(1, Math.max(0, avg * 3.2)))
          }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      setRecording(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone unavailable")
    }
  }, [])

  const stop = React.useCallback(async (): Promise<string | null> => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive") return null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null

    const result = new Promise<string | null>((resolve) => {
      const onStop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        })
        const base64 = blob.size > 0 ? await blobToWavBase64(blob) : null
        chunksRef.current = []
        cleanup()
        resolve(base64)
      }
      const cleanup = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        analyserRef.current = null
        dataRef.current = null
        setRecording(false)
        setLevel(0)
        setBusy(false)
      }
      recorder.onstop = () => {
        void onStop()
      }
    })

    setBusy(true)
    recorder.stop()
    return result
  }, [])

  const play = React.useCallback((base64: string, mime = "audio/wav") => {
    playingRef.current?.pause()
    const audio = new Audio(audioSrc(base64, mime))
    playingRef.current = audio
    void audio.play().catch(() => setError("Audio playback blocked in this browser"))
  }, [setError])

  const stopPlayback = React.useCallback(() => {
    playingRef.current?.pause()
    playingRef.current = null
  }, [])

  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      playingRef.current?.pause()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return { supported, recording, busy, level, durationMs, error, start, stop, play, stopPlayback }
}

function pickMimeType(): string | null {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  for (const candidate of candidates) {
    if (window.MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return null
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new Ctx()
  const audioBuffer = await context.decodeAudioData(arrayBuffer)

  const targetRate = 16000
  const offline = new OfflineAudioContext(1, Math.ceil(audioBuffer.length * (targetRate / audioBuffer.sampleRate)), targetRate)
  const source = offline.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()

  const samples = rendered.getChannelData(0)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }

  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  writeString(view, 0, "RIFF")
  view.setUint32(4, 36 + pcm.length * 2, true)
  writeString(view, 8, "WAVE")
  writeString(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, targetRate, true)
  view.setUint32(28, targetRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, "data")
  view.setUint32(40, pcm.length * 2, true)

  const wav = new Uint8Array(44 + pcm.length * 2)
  wav.set(new Uint8Array(header), 0)
  wav.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44)

  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < wav.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(wav.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}