/**
 * Hands-free voice conversation (phase 1).
 *
 *   listening ──(speech, then ~1.5 s silence)──▶ transcribing ──▶ thinking ──▶ speaking ──▶ listening
 *
 * - Voice activity detection is a simple adaptive energy threshold on 64 ms frames,
 *   with ~320 ms of pre-roll so the first syllable is not lost.
 * - The transcript goes through the normal composer submit path, so the turn is a
 *   regular chat message in the session (same history, same memory).
 * - When the agent finishes, the final assistant reply is spoken sentence by sentence;
 *   the next sentence is synthesized while the current one plays.
 * - The mic is only analysed while listening, and capture uses echo cancellation, so
 *   the assistant does not hear itself. Barge-in comes in phase 2.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { sessionAtomFamily } from '@/atoms/sessions'
import { encodeWav, transcribe } from './voice-services'
import { sharedPlayer } from './sentence-player'

export type VoicePhase = 'off' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

const RATE = 16000
const FRAME = 1024 // 64 ms at 16 kHz
const PREROLL_FRAMES = 5 // ~320 ms
const START_FRAMES = 2 // ~128 ms above threshold to start
const END_SILENCE_FRAMES = 23 // ~1.5 s of silence ends the turn (700 ms cut people off mid-thought)
const MIN_SPEECH_FRAMES = 6 // ~400 ms, shorter is treated as noise
const MAX_FRAMES = Math.round((120 * RATE) / FRAME) // 2 min hard cap
const MIN_THRESHOLD = 0.012
const MAX_SPOKEN_SENTENCES = 8

interface Options {
  sessionId?: string
  isProcessing: boolean
  onSubmit: (message: string) => void
}

function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!
  return Math.sqrt(sum / frame.length)
}

export function useVoiceConversation({ sessionId, isProcessing, onSubmit }: Options) {
  const session = useAtomValue(sessionAtomFamily(sessionId ?? ''))
  const [phase, setPhaseState] = React.useState<VoicePhase>('off')
  const [heard, setHeard] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  const phaseRef = React.useRef<VoicePhase>('off')
  const setPhase = React.useCallback((p: VoicePhase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  const streamRef = React.useRef<MediaStream | null>(null)
  const ctxRef = React.useRef<AudioContext | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const submittedAtRef = React.useRef(0)
  const sawProcessingRef = React.useRef(false)
  const onSubmitRef = React.useRef(onSubmit)
  onSubmitRef.current = onSubmit

  // VAD state
  const vad = React.useRef({ noise: 0.005, active: false, above: 0, silence: 0, speech: 0, frames: [] as Float32Array[], preroll: [] as Float32Array[] })
  const resetVad = () => {
    const v = vad.current
    v.active = false
    v.above = v.silence = v.speech = 0
    v.frames = []
    v.preroll = []
  }

  const handleUtterance = React.useCallback(async (frames: Float32Array[]) => {
    setPhase('transcribing')
    const samples = new Float32Array(frames.length * FRAME)
    frames.forEach((f, i) => samples.set(f, i * FRAME))
    abortRef.current = new AbortController()
    try {
      const text = await transcribe(encodeWav(samples, RATE), 'fala.wav', abortRef.current.signal)
      if (phaseRef.current !== 'transcribing') return // turned off meanwhile
      if (!text) {
        resetVad()
        setPhase('listening')
        return
      }
      setHeard(text)
      submittedAtRef.current = Date.now()
      sawProcessingRef.current = false
      setPhase('thinking')
      onSubmitRef.current(text)
    } catch (err) {
      if (phaseRef.current === 'off') return
      console.error('[voice-mode] transcription failed', err)
      setError('Whisper não respondeu')
      resetVad()
      setPhase('listening')
    }
  }, [setPhase])

  const onFrame = React.useCallback((input: Float32Array) => {
    if (phaseRef.current !== 'listening') return
    const frame = new Float32Array(input) // the input buffer is reused by the audio graph
    const v = vad.current
    const level = rms(frame)
    const threshold = Math.max(v.noise * 3, MIN_THRESHOLD)

    if (!v.active) {
      v.noise = v.noise * 0.95 + level * 0.05 // track background noise while idle
      v.preroll.push(frame)
      if (v.preroll.length > PREROLL_FRAMES) v.preroll.shift()
      v.above = level > threshold ? v.above + 1 : 0
      if (v.above >= START_FRAMES) {
        v.active = true
        v.frames = [...v.preroll]
        v.speech = v.above
        v.silence = 0
      }
      return
    }

    v.frames.push(frame)
    if (level > threshold) {
      v.speech++
      v.silence = 0
    } else {
      v.silence++
    }
    if (v.silence >= END_SILENCE_FRAMES || v.frames.length >= MAX_FRAMES) {
      const frames = v.frames
      const enough = v.speech >= MIN_SPEECH_FRAMES
      resetVad()
      if (enough) void handleUtterance(frames)
    }
  }, [handleUtterance])

  const speak = React.useCallback(async (markdown: string) => {
    setPhase('speaking')
    try {
      await sharedPlayer.play(markdown, { maxSentences: MAX_SPOKEN_SENTENCES })
    } catch (err) {
      if (phaseRef.current === 'off') return
      console.error('[voice-mode] speech failed', err)
      setError('Kokoro não respondeu')
    }
    if (phaseRef.current === 'speaking') {
      resetVad()
      setPhase('listening')
    }
  }, [setPhase])

  // Wait for the agent turn to finish, then speak the final reply.
  React.useEffect(() => {
    if (phase !== 'thinking') return
    if (isProcessing) {
      sawProcessingRef.current = true
      return
    }
    if (!sawProcessingRef.current) return
    const reply = session?.messages.findLast(
      m => m.role === 'assistant' && !m.isIntermediate && m.timestamp >= submittedAtRef.current - 1000,
    )
    if (reply?.content) void speak(reply.content)
    else {
      resetVad()
      setPhase('listening')
    }
  }, [phase, isProcessing, session, speak, setPhase])

  const stop = React.useCallback(() => {
    setPhase('off')
    abortRef.current?.abort()
    sharedPlayer.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null
    resetVad()
  }, [setPhase])

  const start = React.useCallback(async () => {
    setError(null)
    setHeard('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      const ctx = new AudioContext({ sampleRate: RATE })
      const source = ctx.createMediaStreamSource(stream)
      // ScriptProcessor is deprecated but universally available and enough for 64 ms frames.
      const processor = ctx.createScriptProcessor(FRAME, 1, 1)
      processor.onaudioprocess = e => onFrame(e.inputBuffer.getChannelData(0))
      source.connect(processor)
      processor.connect(ctx.destination) // outputs silence; needed for the node to run
      streamRef.current = stream
      ctxRef.current = ctx
      resetVad()
      setPhase('listening')
    } catch (err) {
      console.error('[voice-mode] microphone unavailable', err)
      setError('Microfone indisponível')
      stop()
    }
  }, [onFrame, setPhase, stop])

  // Leaving the session (or unmounting) ends the conversation and frees the mic.
  React.useEffect(() => stop, [sessionId, stop])

  return { phase, heard, error, start, stop, active: phase !== 'off' }
}
