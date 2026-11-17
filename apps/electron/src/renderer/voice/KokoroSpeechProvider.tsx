import * as React from 'react'
import { toast } from 'sonner'
import { SpeechProvider, type SpeechController } from '@craft-agent/ui'
import { PlaybackError, sharedPlayer } from './sentence-player'
import { voiceSetting } from './voice-services'

/**
 * Provides the "listen" button on assistant responses: reads the whole reply with the
 * local Kokoro, sentence by sentence. Clicking another response switches to it.
 */
export function KokoroSpeechProvider({ children }: { children: React.ReactNode }) {
  const [speakingId, setSpeakingId] = React.useState<string | null>(null)
  const [loadingId, setLoadingId] = React.useState<string | null>(null)
  const currentRef = React.useRef<string | null>(null)

  const stop = React.useCallback(() => {
    currentRef.current = null
    sharedPlayer.stop()
    setSpeakingId(null)
    setLoadingId(null)
  }, [])

  const speak = React.useCallback((id: string, markdown: string) => {
    currentRef.current = id
    setSpeakingId(null)
    setLoadingId(id)
    sharedPlayer
      .play(markdown, {
        onStart: () => {
          if (currentRef.current !== id) return
          setLoadingId(null)
          setSpeakingId(id)
        },
      })
      .catch(err => {
        if (currentRef.current !== id) return
        console.error('[speech] playback failed', err)
        toast.error(
          err instanceof PlaybackError
            ? `Não consegui tocar o áudio: ${err.message}`
            : `Kokoro não respondeu em ${voiceSetting('craft:kokoro-url')}`,
        )
      })
      .finally(() => {
        if (currentRef.current !== id) return // another response took over
        currentRef.current = null
        setSpeakingId(null)
        setLoadingId(null)
      })
  }, [])

  // Stop talking if the window is closed or reloaded mid-sentence.
  React.useEffect(() => () => sharedPlayer.stop(), [])

  const value = React.useMemo<SpeechController>(
    () => ({ speakingId, loadingId, speak, stop }),
    [speakingId, loadingId, speak, stop],
  )
  return <SpeechProvider value={value}>{children}</SpeechProvider>
}
