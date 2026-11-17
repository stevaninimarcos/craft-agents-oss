import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { transcribe, voiceSetting } from '@/voice/voice-services'

/**
 * Voice → text for the composer, using the local Whisper server (see voice/voice-services).
 * Click to start recording, click again to stop; the transcript is handed to
 * `onTranscript` and never sent automatically.
 */
const MIN_MS = 400

type VoiceState = 'idle' | 'recording' | 'transcribing'

interface VoiceInputButtonProps {
  disabled?: boolean
  onTranscript: (text: string) => void
}

export function VoiceInputButton({ disabled, onTranscript }: VoiceInputButtonProps) {
  const { t } = useTranslation()
  const [state, setState] = React.useState<VoiceState>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const startedAtRef = React.useRef(0)

  const releaseMic = React.useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach(track => track.stop())
    recorderRef.current = null
  }, [])

  // Never leave the microphone open if the composer unmounts mid-recording.
  React.useEffect(() => releaseMic, [releaseMic])

  const start = React.useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        releaseMic()
        if (Date.now() - startedAtRef.current < MIN_MS || blob.size === 0) {
          setState('idle')
          return
        }
        setState('transcribing')
        try {
          const text = await transcribe(blob, blob.type.includes('ogg') ? 'fala.ogg' : 'fala.webm')
          if (text) onTranscript(text)
          else setError(t('chat.voiceNothingHeard', 'Nada reconhecido'))
        } catch (err) {
          console.error('[voice-input] transcription failed', err)
          setError(t('chat.voiceWhisperDown', 'Whisper não respondeu em {{url}}', {
            url: voiceSetting('craft:whisper-url'),
          }))
        } finally {
          setState('idle')
        }
      }
      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      recorder.start()
      setState('recording')
    } catch (err) {
      console.error('[voice-input] microphone unavailable', err)
      releaseMic()
      setError(t('chat.voiceNoMic', 'Microfone indisponível'))
      setState('idle')
    }
  }, [onTranscript, releaseMic, t])

  const stop = React.useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const handleClick = React.useCallback(() => {
    if (state === 'recording') stop()
    else if (state === 'idle') void start()
  }, [state, start, stop])

  const label =
    state === 'recording'
      ? t('chat.voiceStop', 'Parar e transcrever')
      : state === 'transcribing'
        ? t('chat.voiceTranscribing', 'Transcrevendo…')
        : error ?? t('chat.voiceStart', 'Falar (voz → texto)')

  return (
    <Button
      type="button"
      variant={state === 'recording' ? 'danger-solid' : 'ghost'}
      size="icon"
      aria-label={label}
      title={label}
      data-state={state}
      data-error={error ? 'true' : undefined}
      disabled={disabled || state === 'transcribing'}
      onClick={handleClick}
      className={cn(
        'send-btn shrink-0 rounded-full',
        state === 'recording' && 'animate-pulse',
        error && state === 'idle' && 'text-destructive',
      )}
    >
      {state === 'recording' ? (
        <Square className="size-2.5 fill-current" />
      ) : state === 'transcribing' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Mic className="size-4" />
      )}
    </Button>
  )
}
