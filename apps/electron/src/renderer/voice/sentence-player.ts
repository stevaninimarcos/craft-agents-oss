import { splitSentences, synthesize, toSpeakable } from './voice-services'

/** The audio arrived but the app could not play it (as opposed to Kokoro being down). */
export class PlaybackError extends Error {
  override name = 'PlaybackError'
}

export interface PlayOptions {
  /** Cap on spoken sentences; the rest is replaced by a short "the rest is in the chat". */
  maxSentences?: number
  /** Called once, when the first sentence starts playing. */
  onStart?: () => void
}

/**
 * Speaks a markdown reply with Kokoro, sentence by sentence: the next sentence is
 * synthesized while the current one plays, so audio starts after the first sentence.
 * Code blocks and tables are skipped (they stay in the chat).
 */
export class SentencePlayer {
  private abort: AbortController | null = null
  private audio: HTMLAudioElement | null = null
  private run = 0

  get playing(): boolean {
    return this.abort !== null
  }

  /** Resolves when playback finishes or is stopped. Throws only on synthesis/playback errors. */
  async play(markdown: string, { maxSentences, onStart }: PlayOptions = {}): Promise<void> {
    this.stop()
    const run = ++this.run
    const sentences = splitSentences(toSpeakable(markdown))
    const toSay = maxSentences ? sentences.slice(0, maxSentences) : sentences
    if (maxSentences && sentences.length > maxSentences) toSay.push('O resto está no chat.')
    if (toSay.length === 0) return

    const abort = new AbortController()
    this.abort = abort
    const alive = () => run === this.run && !abort.signal.aborted
    try {
      let next: Promise<Blob> = synthesize(toSay[0]!, abort.signal)
      for (let i = 0; i < toSay.length; i++) {
        const blob = await next
        if (i + 1 < toSay.length) next = synthesize(toSay[i + 1]!, abort.signal) // prefetch
        if (!alive()) return
        if (i === 0) onStart?.()
        const url = URL.createObjectURL(blob)
        try {
          await new Promise<void>((resolve, reject) => {
            const audio = new Audio(url)
            this.audio = audio
            audio.onended = () => resolve()
            audio.onpause = () => resolve() // stop() pauses
            audio.onerror = () => reject(new PlaybackError(audio.error?.message || 'audio playback failed'))
            void audio.play().catch(err => reject(new PlaybackError(String(err?.message ?? err))))
          })
        } finally {
          URL.revokeObjectURL(url)
          if (this.audio && run === this.run) this.audio = null
        }
        if (!alive()) return
      }
    } catch (err) {
      if (!alive()) return // stopped: aborted fetches are expected
      throw err
    } finally {
      if (run === this.run) this.abort = null
    }
  }

  stop(): void {
    this.run++
    this.abort?.abort()
    this.abort = null
    this.audio?.pause()
    this.audio = null
  }
}

/** One player for the whole window, so a new reply never talks over another one. */
export const sharedPlayer = new SentencePlayer()
