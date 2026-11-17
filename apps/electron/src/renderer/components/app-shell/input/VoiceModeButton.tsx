import { useTranslation } from 'react-i18next'
import { AudioLines, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useVoiceConversation, type VoicePhase } from '@/voice/useVoiceConversation'

const PHASE_STYLE: Record<Exclude<VoicePhase, 'off'>, { dot: string; key: string; fallback: string }> = {
  listening: { dot: 'bg-emerald-500', key: 'chat.voiceModeListening', fallback: 'Ouvindo…' },
  transcribing: { dot: 'bg-amber-500', key: 'chat.voiceModeTranscribing', fallback: 'Entendendo…' },
  thinking: { dot: 'bg-sky-500', key: 'chat.voiceModeThinking', fallback: 'Pensando…' },
  speaking: { dot: 'bg-violet-500', key: 'chat.voiceModeSpeaking', fallback: 'Falando…' },
}

interface VoiceModeButtonProps {
  sessionId?: string
  isProcessing: boolean
  disabled?: boolean
  onSubmit: (message: string) => void
}

/**
 * Enters hands-free voice conversation: speak, pause, hear the reply, speak again.
 * While active it shows the current phase as a pill; click it to leave.
 */
export function VoiceModeButton({ sessionId, isProcessing, disabled, onSubmit }: VoiceModeButtonProps) {
  const { t } = useTranslation()
  const voice = useVoiceConversation({ sessionId, isProcessing, onSubmit })

  if (!voice.active) {
    const label = voice.error ?? t('chat.voiceModeStart', 'Conversar por voz')
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => void voice.start()}
        className={cn('send-btn shrink-0 rounded-full', voice.error && 'text-destructive')}
      >
        <AudioLines className="size-4" />
      </Button>
    )
  }

  const style = PHASE_STYLE[voice.phase as Exclude<VoicePhase, 'off'>]
  const status = t(style.key, style.fallback)
  const title = voice.heard
    ? `${status} — “${voice.heard}” · ${t('chat.voiceModeExit', 'clique para sair do modo voz')}`
    : `${status} · ${t('chat.voiceModeExit', 'clique para sair do modo voz')}`

  return (
    <button
      type="button"
      onClick={voice.stop}
      title={title}
      aria-label={title}
      className="input-toolbar-btn motion-press state-overlay inline-flex h-control shrink-0 items-center gap-1.5 rounded-full px-2.5 text-label font-medium"
    >
      <span className="relative flex size-2">
        <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', style.dot)} />
        <span className={cn('relative inline-flex size-2 rounded-full', style.dot)} />
      </span>
      <span>{status}</span>
      <X className="size-3 opacity-60" />
    </button>
  )
}
