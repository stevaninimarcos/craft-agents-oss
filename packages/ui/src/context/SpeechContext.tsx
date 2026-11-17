/**
 * SpeechContext - optional text-to-speech for assistant responses.
 *
 * The desktop app provides an implementation (local Kokoro); hosts that don't
 * (e.g. the web viewer) simply render no "listen" button.
 */
import { createContext, useContext, type ReactNode } from 'react'

export interface SpeechController {
  /** Id of the response currently playing, if any */
  speakingId: string | null
  /** Id of the response whose audio is being generated, if any */
  loadingId: string | null
  /** Speak a response (markdown). Stops whatever was playing before. */
  speak: (id: string, markdown: string) => void
  stop: () => void
}

const SpeechContext = createContext<SpeechController | null>(null)

export function SpeechProvider({ value, children }: { value: SpeechController | null; children: ReactNode }) {
  return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>
}

export function useSpeech(): SpeechController | null {
  return useContext(SpeechContext)
}
