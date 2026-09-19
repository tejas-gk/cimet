"use client"

import * as React from "react"
import {
    BotIcon,
    HeadphonesIcon,
    MicIcon,
    CircleStopIcon,
    PhoneForwardedIcon,
    SendIcon,
    Phone,
    Volume2Icon,
} from "lucide-react"

import {
    useVoiceRecorder,
    audioSrc,
} from "@/hooks/use-voice-recorder"

import { useSolarAgent } from "@/hooks/use-solar-agent"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
    onClose: () => void

    leadId?: string | null
    callId?: string | null
    initialAudio?: string | null

    onPlaceCall?: (
        leadId: string
    ) => Promise<string | null>

    onExtractedData?: (
        data: Partial<
            Record<string, string>
        >
    ) => void

    onSaveRecording?: (
        base64: string,
        transcript: string
    ) => Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation UI
// ─────────────────────────────────────────────────────────────────────────────

const SPEAKER_LABEL: Record<
    string,
    string
> = {
    user: "You",

    ai: "Priya · AI sales rep",

    "human-agent":
        "David · Human agent",
}

function speakerTone(
    speaker: string
) {
    if (speaker === "user") {
        return "ml-8 rounded-xl border-zinc-700 bg-[#141416]"
    }

    if (
        speaker === "human-agent"
    ) {
        return "mr-8 rounded-xl border-amber-500/30 bg-amber-500/10"
    }

    return "mr-8 rounded-xl border-sky-500/30 bg-sky-500/10"
}

function speakerIcon(
    speaker: string
) {
    if (speaker === "user") {
        return (
            <span className="size-4">
                🙂
            </span>
        )
    }

    if (
        speaker === "human-agent"
    ) {
        return (
            <HeadphonesIcon className="size-4" />
        )
    }

    return (
        <BotIcon className="size-4" />
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn-taking configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long the customer can remain silent before we consider
 * their turn complete.
 *
 * 3000ms allows natural thinking pauses without Priya
 * immediately interrupting.
 */
const CUSTOMER_SILENCE_MS = 3000

/**
 * Ignore tiny accidental recordings.
 */
const MIN_RECORD_MS = 1000

/**
 * Existing microphone silence threshold.
 *
 * You may need to tune this depending on the room/microphone.
 */
const SILENCE_LEVEL = 0.08

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function LeadSolarPreview({
    onClose,

    leadId,

    callId,

    initialAudio,

    onPlaceCall,

    onExtractedData,

    onSaveRecording,
}: Props) {
    // ───────────────────────────────────────────────────────────────────────────
    // API path
    // ───────────────────────────────────────────────────────────────────────────

    const basePath =
        React.useMemo(
            () =>
                callId
                    ? `/api/calls/${callId}`
                    : "/api/solar",

            [callId]
        )

    const agent =
        useSolarAgent(basePath)

    const recorder =
        useVoiceRecorder()

    // ───────────────────────────────────────────────────────────────────────────
    // Lead context
    // ───────────────────────────────────────────────────────────────────────────

    const [
        leadContext,
        setLeadContext,
    ] = React.useState<
        Record<string, string> | undefined
    >(undefined)

    React.useEffect(() => {
        if (!leadId) {
            setLeadContext(undefined)
            return
        }

        /**
         * Minimal context for preview mode.
         *
         * In the real call-specific API, the server should load the
         * full journey from the DB.
         */
        setLeadContext({
            leadId,
        })
    }, [leadId])

    // ───────────────────────────────────────────────────────────────────────────
    // UI state
    // ───────────────────────────────────────────────────────────────────────────

    const [
        answer,
        setAnswer,
    ] = React.useState("")

    /**
     * True while Priya/human-agent audio is playing.
     *
     * This is important for turn-taking:
     *
     * AI speaking
     *   ↓
     * customer microphone disabled
     */
    const [
        speaking,
        setSpeaking,
    ] = React.useState(false)

    const [
        placing,
        setPlacing,
    ] = React.useState(false)

    /**
     * Prevent duplicate submissions caused by:
     *
     * manual stop
     * +
     * auto silence stop
     *
     * firing around the same time.
     */
    const submittingRef =
        React.useRef(false)

    /**
     * Keep track of the currently playing audio so we can
     * clean it up if necessary.
     */
    const currentAudioRef =
        React.useRef<HTMLAudioElement | null>(
            null
        )

    // ───────────────────────────────────────────────────────────────────────────
    // Play AI turns
    // ───────────────────────────────────────────────────────────────────────────

    const playTurns =
        React.useCallback(
            async (
                turns: Array<{
                    audioBase64:
                    | string
                    | null
                }>
            ) => {
                /**
                 * Stop recording before Priya starts speaking.
                 *
                 * Normally recording should already have stopped because
                 * a completed customer turn caused this response.
                 */
                setSpeaking(true)

                try {
                    for (const turn of turns) {
                        if (!turn.audioBase64) {
                            continue
                        }

                        await new Promise<void>(
                            (resolve) => {
                                const audio =
                                    new Audio(
                                        audioSrc(
                                            turn.audioBase64!
                                        )
                                    )

                                currentAudioRef.current =
                                    audio

                                let finished = false

                                const finish = () => {
                                    if (finished) {
                                        return
                                    }

                                    finished = true

                                    if (
                                        currentAudioRef.current ===
                                        audio
                                    ) {
                                        currentAudioRef.current =
                                            null
                                    }

                                    resolve()
                                }

                                audio.onended =
                                    finish

                                audio.onerror =
                                    finish

                                void audio
                                    .play()
                                    .catch(() => {
                                        finish()
                                    })
                            }
                        )
                    }
                } finally {
                    setSpeaking(false)
                }
            },

            []
        )

    // ───────────────────────────────────────────────────────────────────────────
    // Submit recorded customer turn
    // ───────────────────────────────────────────────────────────────────────────

    const submitRef =
        React.useRef<
            (
                base64:
                    | string
                    | null
            ) => Promise<void>
        >(async () => { })

    submitRef.current =
        async (
            base64:
                | string
                | null
        ) => {
            if (!base64) {
                return
            }

            /**
             * Prevent the same recording being submitted twice.
             */
            if (
                submittingRef.current
            ) {
                return
            }

            submittingRef.current =
                true

            try {
                const result =
                    await agent.sendTurn({
                        audioBase64:
                            base64,

                        leadContext,
                    })

                if (!result) {
                    return
                }

                // ─────────────────────────────────────────────────────────────────────
                // Update extracted lead information
                // ─────────────────────────────────────────────────────────────────────

                if (
                    result.extractedData &&
                    onExtractedData
                ) {
                    onExtractedData(
                        result.extractedData
                    )
                }

                // ─────────────────────────────────────────────────────────────────────
                // Save preview recording
                // ─────────────────────────────────────────────────────────────────────

                if (
                    onSaveRecording
                ) {
                    try {
                        await onSaveRecording(
                            base64,
                            result.transcript
                        )
                    } catch (error) {
                        console.warn(
                            "Failed to save preview recording",
                            error
                        )
                    }
                }

                // ─────────────────────────────────────────────────────────────────────
                // AI's turn
                // ─────────────────────────────────────────────────────────────────────

                await playTurns(
                    result.turns
                )
            } catch (error) {
                console.error(
                    "Failed to submit voice turn",
                    error
                )
            } finally {
                submittingRef.current =
                    false
            }
        }

    // ───────────────────────────────────────────────────────────────────────────
    // Voice button
    // ───────────────────────────────────────────────────────────────────────────

    const handleVoice =
        async () => {
            /**
             * Half-duplex protection:
             *
             * Don't start listening while Priya is speaking.
             */
            if (speaking) {
                return
            }

            /**
             * Don't start another recording while we're processing
             * the previous customer turn.
             */
            if (
                submittingRef.current
            ) {
                return
            }

            // ───────────────────────────────────────────────────────────────────────
            // User manually ends their turn
            // ───────────────────────────────────────────────────────────────────────

            if (
                recorder.recording
            ) {
                const base64 =
                    await recorder.stop()

                await submitRef.current(
                    base64
                )

                return
            }

            // ───────────────────────────────────────────────────────────────────────
            // Begin customer's turn
            // ───────────────────────────────────────────────────────────────────────

            await recorder.start({
                /**
                 * After 3 seconds of silence:
                 *
                 * CUSTOMER TURN
                 *      ↓
                 * considered finished
                 *      ↓
                 * send to STT/agent
                 *      ↓
                 * PRIYA TURN
                 */
                onAutoStop: (
                    base64
                ) => {
                    void submitRef.current(
                        base64
                    )
                },

                /**
                 * Short thinking pauses do NOT end the customer's turn.
                 */
                silenceMs:
                    CUSTOMER_SILENCE_MS,

                minRecordMs:
                    MIN_RECORD_MS,

                silenceLevel:
                    SILENCE_LEVEL,
            })
        }

    // ───────────────────────────────────────────────────────────────────────────
    // Text response
    // ───────────────────────────────────────────────────────────────────────────

    const handleText =
        async (
            raw: string
        ) => {
            const text =
                raw.trim()

            if (!text) {
                return
            }

            if (speaking) {
                return
            }

            setAnswer("")

            try {
                const result =
                    await agent.sendTurn({
                        text,
                        leadContext,
                    })

                if (!result) {
                    return
                }

                if (
                    result.extractedData &&
                    onExtractedData
                ) {
                    onExtractedData(
                        result.extractedData
                    )
                }

                await playTurns(
                    result.turns
                )
            } catch (error) {
                console.error(
                    "Failed to submit text turn",
                    error
                )
            }
        }

    // ───────────────────────────────────────────────────────────────────────────
    // Escalation
    // ───────────────────────────────────────────────────────────────────────────

    const handleEscalate =
        async () => {
            if (speaking) {
                return
            }

            try {
                const result =
                    await agent.escalate()

                if (result) {
                    await playTurns(
                        result.turns
                    )
                }
            } catch (error) {
                console.error(
                    "Failed to escalate call",
                    error
                )
            }
        }

    // ───────────────────────────────────────────────────────────────────────────
    // Initial greeting
    // ───────────────────────────────────────────────────────────────────────────

    React.useEffect(() => {
        let cancelled = false

        void (async () => {
            /**
             * Existing real call:
             *
             * Parent already received greeting audio from the server.
             * Don't call /api/solar/start again.
             */
            if (
                callId &&
                initialAudio
            ) {
                if (!cancelled) {
                    await playTurns([
                        {
                            audioBase64:
                                initialAudio,
                        },
                    ])
                }

                return
            }

            /**
             * Preview mode.
             */
            const greeting =
                await agent.start()

            if (
                cancelled ||
                !greeting?.audioBase64
            ) {
                return
            }

            await playTurns([
                greeting,
            ])
        })()

        return () => {
            cancelled = true
        }

        // Intentionally tied to call/audio identity.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        callId,
        initialAudio,
    ])

    // ───────────────────────────────────────────────────────────────────────────
    // Place actual call
    // ───────────────────────────────────────────────────────────────────────────

    const handlePlaceCall =
        async () => {
            if (
                !leadId ||
                !onPlaceCall ||
                placing
            ) {
                return
            }

            setPlacing(true)

            try {
                await onPlaceCall(
                    leadId
                )

                /**
                 * Parent updates:
                 *
                 * callId
                 * initialAudio
                 *
                 * after the call is created.
                 */
            } catch (error) {
                console.error(
                    "Failed to place call",
                    error
                )
            } finally {
                setPlacing(false)
            }
        }

    // ───────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ───────────────────────────────────────────────────────────────────────────

    React.useEffect(() => {
        return () => {
            const audio =
                currentAudioRef.current

            if (audio) {
                audio.pause()
                audio.src = ""
                currentAudioRef.current =
                    null
            }
        }
    }, [])

    // ───────────────────────────────────────────────────────────────────────────
    // Derived UI state
    // ───────────────────────────────────────────────────────────────────────────

    const busy =
        speaking ||
        submittingRef.current

    let voiceButtonText =
        "Tap to talk"

    if (speaking) {
        voiceButtonText =
            "Priya is speaking…"
    } else if (
        recorder.recording
    ) {
        voiceButtonText =
            `Listening · ${Math.round(
                recorder.durationMs /
                1000
            )}s`
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Render
    // ───────────────────────────────────────────────────────────────────────────

    return (
        <div className="w-full max-w-2xl rounded-xl border border-[#27272a] bg-[#0b0b0c] p-4">
            {/* Header */}

            <div className="flex items-center justify-between">
                <div>
                    <div className="font-medium">
                        Energy recovery preview
                    </div>

                    <div className="mt-0.5 text-xs text-zinc-500">
                        {callId
                            ? `Call ${callId}`
                            : "AI conversation simulator"}
                    </div>
                </div>

                <Button
                    size="sm"
                    variant="outline"
                    onClick={onClose}
                >
                    Close
                </Button>
            </div>

            {/* Conversation */}

            <div className="mt-3">
                <div className="rounded-xl border border-[#27272a] bg-[#0d0d0f] p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs text-zinc-400">
                            Conversation
                        </div>

                        {/* Current speaker indicator */}

                        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                            {speaking ? (
                                <>
                                    <Volume2Icon className="size-3.5" />
                                    Priya's turn
                                </>
                            ) : recorder.recording ? (
                                <>
                                    <MicIcon className="size-3.5" />
                                    Your turn
                                </>
                            ) : (
                                "Ready"
                            )}
                        </div>
                    </div>

                    <div className="max-h-64 space-y-2 overflow-y-auto">
                        {agent.messages.map(
                            (msg) => (
                                <div
                                    key={msg.id}
                                    className={cn(
                                        "rounded-lg border p-3",

                                        speakerTone(
                                            msg.speaker
                                        )
                                    )}
                                >
                                    <div className="mb-1 flex items-center gap-1.5 text-xs tracking-wide text-zinc-400 uppercase">
                                        {speakerIcon(
                                            msg.speaker
                                        )}

                                        {
                                            SPEAKER_LABEL[
                                            msg.speaker
                                            ]
                                        }
                                    </div>

                                    <div className="text-sm leading-6 text-zinc-100">
                                        {msg.text}
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </div>

                {/* Voice controls */}

                <div className="mt-3">
                    <div className="flex items-center gap-3">
                        <Button
                            className="flex-1"
                            variant={
                                recorder.recording
                                    ? "destructive"
                                    : "default"
                            }
                            onClick={() =>
                                void handleVoice()
                            }
                            disabled={
                                speaking ||
                                submittingRef.current
                            }
                        >
                            {speaking ? (
                                <Volume2Icon className="size-4" />
                            ) : recorder.recording ? (
                                <CircleStopIcon className="size-4" />
                            ) : (
                                <MicIcon className="size-4" />
                            )}

                            {voiceButtonText}
                        </Button>

                        {/* Mic level */}

                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#222226]">
                            <div
                                className="h-full rounded-full bg-sky-400 transition-[width] duration-75"
                                style={{
                                    width: `${recorder.recording
                                            ? Math.max(
                                                4,
                                                recorder.level *
                                                100
                                            )
                                            : 4
                                        }%`,
                                }}
                            />
                        </div>
                    </div>

                    {/* Turn-taking hint */}

                    {recorder.recording && (
                        <div className="mt-2 text-xs text-zinc-500">
                            Keep speaking naturally.
                            Short pauses are okay —
                            Priya responds after about
                            3 seconds of silence.
                        </div>
                    )}

                    {speaking && (
                        <div className="mt-2 text-xs text-sky-400">
                            Priya is speaking. Your
                            microphone will be available
                            when she finishes.
                        </div>
                    )}

                    {/* Text controls */}

                    <div className="mt-3">
                        <form
                            onSubmit={(e) => {
                                e.preventDefault()

                                if (
                                    answer.trim() &&
                                    !busy
                                ) {
                                    void handleText(
                                        answer
                                    )
                                }
                            }}
                            className="grid gap-2"
                        >
                            <Input
                                value={answer}
                                onChange={(e) =>
                                    setAnswer(
                                        e.target.value
                                    )
                                }
                                placeholder={
                                    speaking
                                        ? "Priya is speaking…"
                                        : "Type your reply…"
                                }
                                disabled={busy}
                            />

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="submit"
                                    disabled={
                                        busy ||
                                        !answer.trim()
                                    }
                                >
                                    <SendIcon className="size-4" />
                                    Send
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                        void handleEscalate()
                                    }
                                    disabled={busy}
                                >
                                    <PhoneForwardedIcon className="size-4" />
                                    Escalate
                                </Button>

                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() =>
                                        void handlePlaceCall()
                                    }
                                    disabled={
                                        !leadId ||
                                        placing
                                    }
                                >
                                    <Phone className="size-4" />

                                    {placing
                                        ? "Placing…"
                                        : callId
                                            ? `In call ${callId}`
                                            : "Place call"}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    )
}