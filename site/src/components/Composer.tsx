import { useRef, useState } from 'react'
import { IconMic, IconSend } from './Icons'

const MIN_CLIP_MS = 400

export default function Composer({
  onSend,
  onVoice,
  disabled = false,
}: {
  onSend: (text: string) => void
  onVoice: (blob: Blob) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startedRef = useRef(0)

  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  const stopTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startRecording = async () => {
    if (disabled || recording) return
    setHint(null)
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      setHint('voice capture unavailable — type instead')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const held = Date.now() - startedRef.current
        if (held >= MIN_CLIP_MS && chunksRef.current.length) {
          onVoice(new Blob(chunksRef.current, { type: rec.mimeType }))
        } else if (held < MIN_CLIP_MS) {
          setHint('hold the mic to talk')
        }
      }
      recRef.current = rec
      startedRef.current = Date.now()
      rec.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = window.setInterval(
        () => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)),
        250,
      )
    } catch {
      setHint('microphone unavailable — type instead')
    }
  }

  const stopRecording = () => {
    stopTimer()
    if (!recording) return
    setRecording(false)
    recRef.current?.stop()
    recRef.current = null
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-2xl border border-edge bg-white/70 p-2 pl-4 shadow-sm backdrop-blur transition-colors focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20 dark:bg-white/[0.04]">
        {recording ? (
          <span className="flex flex-1 items-center gap-2 font-mono text-tiny text-red-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            recording {elapsed}s — release to send
          </span>
        ) : (
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
            disabled={disabled}
            placeholder="Describe a scenario, or hold the mic to talk…"
            className="flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink/35"
          />
        )}
        <button
          type="button"
          title="hold to talk"
          aria-label="hold to talk"
          onPointerDown={startRecording}
          onPointerUp={stopRecording}
          onPointerLeave={stopRecording}
          onPointerCancel={stopRecording}
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-full transition-colors ${
            recording
              ? 'bg-red-500/15 text-red-500'
              : 'text-ink/50 hover:bg-ink/5 hover:text-ink'
          }`}
        >
          <IconMic size={16} />
        </button>
        <button
          type="button"
          title="send"
          aria-label="send"
          onClick={send}
          disabled={disabled}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ink text-bg transition-opacity hover:opacity-80 disabled:opacity-40"
        >
          <IconSend size={14} />
        </button>
      </div>
      {hint && (
        <p className="mt-1.5 pl-2 font-mono text-micro lowercase text-ink/50">{hint}</p>
      )}
    </div>
  )
}
