/**
 * Local voice services shared by the composer mic button and voice conversation mode.
 *
 * - Whisper (speaches / faster-whisper, OpenAI-compatible) for speech → text
 * - Kokoro (kokoro-fastapi, OpenAI-compatible) for text → speech
 *
 * Overrides (localStorage): craft:whisper-url, craft:whisper-model, craft:whisper-prompt,
 * craft:kokoro-url, craft:kokoro-voice.
 */
import { stripMarkdown } from '@/utils/text'

const DEFAULTS = {
  'craft:whisper-url': 'http://localhost:8000',
  'craft:whisper-model': 'Systran/faster-whisper-small',
  // English terms Whisper garbles in Portuguese speech unless primed with them.
  'craft:whisper-prompt':
    'Conversa com a Júlia sobre GitHub, pull requests, Jira, board, sprint, Obsidian, MCP, Craft Agent, Claude Code, commit, branch.',
  'craft:kokoro-url': 'http://localhost:8880',
  'craft:kokoro-voice': 'pf_dora',
} as const

export function voiceSetting(key: keyof typeof DEFAULTS): string {
  try {
    return localStorage.getItem(key) || DEFAULTS[key]
  } catch {
    return DEFAULTS[key]
  }
}

const base = (key: 'craft:whisper-url' | 'craft:kokoro-url') => voiceSetting(key).replace(/\/+$/, '')

/** Speech → text. Accepts any container Whisper can decode (webm/opus, wav, …). */
export async function transcribe(audio: Blob, filename = 'fala.webm', signal?: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', voiceSetting('craft:whisper-model'))
  form.append('language', 'pt')
  form.append('response_format', 'json')
  form.append('prompt', voiceSetting('craft:whisper-prompt'))
  const res = await fetch(`${base('craft:whisper-url')}/v1/audio/transcriptions`, { method: 'POST', body: form, signal })
  if (!res.ok) throw new Error(`Whisper HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}

/** Text → speech (mp3). */
export async function synthesize(text: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`${base('craft:kokoro-url')}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'kokoro',
      input: text,
      voice: voiceSetting('craft:kokoro-voice'),
      response_format: 'mp3',
    }),
    signal,
  })
  if (!res.ok) throw new Error(`Kokoro HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.blob()
}

/** Mono float PCM → 16-bit WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Turn an assistant reply into something worth saying out loud: drop code blocks,
 * tables and diagrams (they stay in the chat), then strip the remaining markdown.
 */
export function toSpeakable(markdown: string): string {
  const withoutBlocks = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter(line => !/^\s*\|/.test(line)) // table rows
    .join('\n')
  return stripMarkdown(withoutBlocks)
}

/** Split into sentences so the first one can play while the next is synthesized. */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) ?? [])
    .map(s => s.trim())
    .filter(s => s.length > 1)
}
