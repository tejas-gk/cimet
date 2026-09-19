"use client"

import * as React from "react"
import {
    HeadphonesIcon,
    MicIcon,
    PhoneIcon,
    PhoneOffIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"

type Props = {
    callId: string
}

type SignalMessage =
    | {
        type: "customer-ready"
        callId: string
    }
    | {
        type: "human-ready"
        callId: string
    }
    | {
        type: "offer"
        callId: string
        sdp: RTCSessionDescriptionInit
    }
    | {
        type: "answer"
        callId: string
        sdp: RTCSessionDescriptionInit
    }
    | {
        type: "ice"
        callId: string
        candidate: RTCIceCandidateInit
    }
    | {
        type: "hangup"
        callId: string
    }

function channelName(callId: string) {
    return `cimet-human-call:${callId}`
}

export default function HumanAgentConsole({
    callId,
}: Props) {
    const [incoming, setIncoming] =
        React.useState(false)

    const [connected, setConnected] =
        React.useState(false)

    const [connecting, setConnecting] =
        React.useState(false)

    const [error, setError] =
        React.useState<string | null>(null)

    const channelRef =
        React.useRef<BroadcastChannel | null>(
            null
        )

    const peerRef =
        React.useRef<RTCPeerConnection | null>(
            null
        )

    const localStreamRef =
        React.useRef<MediaStream | null>(
            null
        )

    const remoteAudioRef =
        React.useRef<HTMLAudioElement | null>(
            null
        )

    const pendingOfferRef =
        React.useRef<RTCSessionDescriptionInit | null>(
            null
        )

    const pendingIceRef =
        React.useRef<
            RTCIceCandidateInit[]
        >([])

    /*
    |--------------------------------------------------------------------------
    | Signalling channel
    |--------------------------------------------------------------------------
    */

    React.useEffect(() => {
        const channel =
            new BroadcastChannel(
                channelName(callId)
            )

        channelRef.current =
            channel

        channel.onmessage = (
            event: MessageEvent<SignalMessage>
        ) => {
            const message =
                event.data

            if (
                message.callId !== callId
            ) {
                return
            }

            if (
                message.type ===
                "customer-ready"
            ) {
                setIncoming(true)

                /*
                 * Tell customer an agent tab exists.
                 */
                channel.postMessage({
                    type: "human-ready",
                    callId,
                } satisfies SignalMessage)

                return
            }

            if (
                message.type === "offer"
            ) {
                pendingOfferRef.current =
                    message.sdp

                setIncoming(true)

                return
            }

            if (
                message.type === "ice"
            ) {
                const peer =
                    peerRef.current

                if (
                    peer?.remoteDescription
                ) {
                    void peer
                        .addIceCandidate(
                            message.candidate
                        )
                        .catch(console.warn)
                } else {
                    pendingIceRef.current.push(
                        message.candidate
                    )
                }

                return
            }

            if (
                message.type === "hangup"
            ) {
                endCall(false)
            }
        }

        return () => {
            channel.close()

            if (
                channelRef.current ===
                channel
            ) {
                channelRef.current =
                    null
            }
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [callId])

    /*
    |--------------------------------------------------------------------------
    | Accept call
    |--------------------------------------------------------------------------
    */

    const acceptCall =
        async () => {
            if (
                connected ||
                connecting
            ) {
                return
            }

            setConnecting(true)
            setError(null)

            try {
                const localStream =
                    await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                    })

                localStreamRef.current =
                    localStream

                const peer =
                    new RTCPeerConnection({
                        iceServers: [
                            {
                                urls: [
                                    "stun:stun.l.google.com:19302",
                                ],
                            },
                        ],
                    })

                peerRef.current =
                    peer

                for (
                    const track of
                    localStream.getTracks()
                ) {
                    peer.addTrack(
                        track,
                        localStream
                    )
                }

                const remoteAudio =
                    new Audio()

                remoteAudio.autoplay = true

                remoteAudioRef.current =
                    remoteAudio

                peer.ontrack = (
                    event
                ) => {
                    const [stream] =
                        event.streams

                    if (!stream) return

                    remoteAudio.srcObject =
                        stream

                    void remoteAudio
                        .play()
                        .catch(() => { })
                }

                peer.onicecandidate =
                    (event) => {
                        if (
                            !event.candidate
                        ) {
                            return
                        }

                        channelRef.current?.postMessage({
                            type: "ice",
                            callId,
                            candidate:
                                event.candidate.toJSON(),
                        } satisfies SignalMessage)
                    }

                peer.onconnectionstatechange =
                    () => {
                        if (
                            peer.connectionState ===
                            "connected"
                        ) {
                            setConnected(true)
                            setConnecting(false)
                            setIncoming(false)
                        }

                        if (
                            peer.connectionState ===
                            "failed" ||
                            peer.connectionState ===
                            "disconnected" ||
                            peer.connectionState ===
                            "closed"
                        ) {
                            setConnected(false)
                        }
                    }

                /*
                 * We might not have received the offer yet.
                 *
                 * Re-announce human readiness.
                 */
                channelRef.current?.postMessage({
                    type: "human-ready",
                    callId,
                } satisfies SignalMessage)

                /*
                 * Give the customer a moment to create
                 * the offer if necessary.
                 */
                let offer =
                    pendingOfferRef.current

                if (!offer) {
                    offer =
                        await waitForOffer(
                            5000
                        )
                }

                if (!offer) {
                    throw new Error(
                        "Customer WebRTC offer was not received."
                    )
                }

                await peer.setRemoteDescription(
                    offer
                )

                /*
                 * Add ICE candidates that arrived
                 * before remoteDescription.
                 */
                for (
                    const candidate of
                    pendingIceRef.current
                ) {
                    await peer.addIceCandidate(
                        candidate
                    )
                }

                pendingIceRef.current = []

                const answer =
                    await peer.createAnswer()

                await peer.setLocalDescription(
                    answer
                )

                channelRef.current?.postMessage({
                    type: "answer",
                    callId,
                    sdp: answer,
                } satisfies SignalMessage)
            } catch (err) {
                console.error(
                    "Unable to accept human call",
                    err
                )

                setError(
                    err instanceof Error
                        ? err.message
                        : "Unable to accept call."
                )

                setConnecting(false)
            }
        }

    /*
    |--------------------------------------------------------------------------
    | Wait for WebRTC offer
    |--------------------------------------------------------------------------
    */

    const waitForOffer =
        (
            timeoutMs: number
        ): Promise<RTCSessionDescriptionInit | null> =>
            new Promise(
                (resolve) => {
                    const started =
                        Date.now()

                    const check = () => {
                        if (
                            pendingOfferRef.current
                        ) {
                            resolve(
                                pendingOfferRef.current
                            )

                            return
                        }

                        if (
                            Date.now() -
                            started >=
                            timeoutMs
                        ) {
                            resolve(null)

                            return
                        }

                        window.setTimeout(
                            check,
                            100
                        )
                    }

                    check()
                }
            )

    /*
    |--------------------------------------------------------------------------
    | End human call
    |--------------------------------------------------------------------------
    */

    function endCall(
        notify = true
    ) {
        if (notify) {
            channelRef.current?.postMessage({
                type: "hangup",
                callId,
            } satisfies SignalMessage)
        }

        peerRef.current?.close()

        peerRef.current = null

        localStreamRef.current
            ?.getTracks()
            .forEach((track) =>
                track.stop()
            )

        localStreamRef.current =
            null

        if (
            remoteAudioRef.current
        ) {
            remoteAudioRef.current.pause()

            remoteAudioRef.current.srcObject =
                null
        }

        remoteAudioRef.current =
            null

        setConnected(false)
        setConnecting(false)
    }

    /*
    |--------------------------------------------------------------------------
    | Cleanup
    |--------------------------------------------------------------------------
    */

    React.useEffect(() => {
        return () => {
            peerRef.current?.close()

            localStreamRef.current
                ?.getTracks()
                .forEach((track) =>
                    track.stop()
                )

            remoteAudioRef.current?.pause()
        }
    }, [])

    /*
    |--------------------------------------------------------------------------
    | Render
    |--------------------------------------------------------------------------
    */

    return (
        <div className="w-full max-w-xl rounded-xl border border-[#27272a] bg-[#0b0b0c] p-5">
            <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-amber-500/10">
                    <HeadphonesIcon className="size-5 text-amber-400" />
                </div>

                <div>
                    <div className="font-medium">
                        Human agent console
                    </div>

                    <div className="text-xs text-zinc-500">
                        Call {callId}
                    </div>
                </div>
            </div>

            <div className="mt-5 rounded-xl border border-[#27272a] p-4">
                {connected ? (
                    <>
                        <div className="flex items-center gap-2 text-green-400">
                            <MicIcon className="size-4" />

                            <span className="font-medium">
                                Live with customer
                            </span>
                        </div>

                        <p className="mt-2 text-sm text-zinc-400">
                            Your microphone is connected
                            directly to the customer's
                            browser. There is no AI in this
                            audio path.
                        </p>

                        <Button
                            className="mt-4"
                            variant="destructive"
                            onClick={() =>
                                endCall()
                            }
                        >
                            <PhoneOffIcon className="size-4" />
                            End call
                        </Button>
                    </>
                ) : incoming ? (
                    <>
                        <div className="font-medium">
                            Incoming AI handoff
                        </div>

                        <p className="mt-1 text-sm text-zinc-400">
                            Priya has escalated this customer.
                        </p>

                        <Button
                            className="mt-4"
                            onClick={() =>
                                void acceptCall()
                            }
                            disabled={connecting}
                        >
                            <PhoneIcon className="size-4" />

                            {connecting
                                ? "Connecting…"
                                : "Accept call"}
                        </Button>
                    </>
                ) : (
                    <>
                        <div className="font-medium">
                            Waiting for handoff
                        </div>

                        <p className="mt-1 text-sm text-zinc-500">
                            Incoming escalations will appear
                            here.
                        </p>
                    </>
                )}

                {error && (
                    <div className="mt-3 text-sm text-red-400">
                        {error}
                    </div>
                )}
            </div>
        </div>
    )
}