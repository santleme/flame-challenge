import { useEffect, useRef, useState } from 'react'
import { IconMic, IconSend } from './Icons'
import MathematicalFlameField, { parseFlameParameters, type FlameParameters } from './MathematicalFlameField'

const MIN_CLIP_MS = 400
const MAX_TEXTAREA_HEIGHT = 160

export default function Composer({
  onSend,
  onVoice,
  disabled = false,
  flameDefaults,
}: {
  onSend: (text: string) => void
  onVoice: (blob: Blob) => void
  disabled?: boolean
  flameDefaults?: FlameParameters
}) {
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const [startingRecording, setStartingRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startedRef = useRef(0)
  const holdingRef = useRef(false)
  const cancelRecordingRef = useRef(false)
  const [pulse, setPulse] = useState({ id: 0, position: 0.5 })
  const [regime, setRegime] = useState<'auto' | 'earth' | 'micro' | 'cool'>('auto')
  const formRef = useRef<HTMLFormElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const parsedParameters = parseFlameParameters(text, flameDefaults)
  const flameParameters: FlameParameters =
    regime === 'earth'
      ? { ...parsedParameters, gravityG: 1, coolFlame: false }
      : regime === 'micro'
        ? { ...parsedParameters, gravityG: 0, coolFlame: false }
        : regime === 'cool'
          ? { ...parsedParameters, coolFlame: true }
          : parsedParameters

  const cycleRegime = () => {
    setRegime((current) =>
      current === 'auto' ? 'earth' : current === 'earth' ? 'micro' : current === 'micro' ? 'cool' : 'auto',
    )
  }

  const stopTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const send = () => {
    const message = text.trim()
    if (!message || disabled || recording || startingRecording) return
    onSend(message)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const startRecording = async () => {
    if (disabled || holdingRef.current || recording || startingRecording) return
    holdingRef.current = true
    setHint(null)

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      holdingRef.current = false
      setHint('Voice recording is not available here. You can type instead.')
      return
    }

    setStartingRecording(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!holdingRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const recorder = new MediaRecorder(stream)
      streamRef.current = stream
      cancelRecordingRef.current = false
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (streamRef.current === stream) streamRef.current = null
        if (recRef.current === recorder) recRef.current = null
        const heldFor = Date.now() - startedRef.current
        if (!cancelRecordingRef.current && heldFor >= MIN_CLIP_MS && chunksRef.current.length > 0) {
          onVoice(new Blob(chunksRef.current, { type: recorder.mimeType }))
        } else if (heldFor < MIN_CLIP_MS) {
          setHint('Hold a little longer to record a voice message.')
        }
      }

      recRef.current = recorder
      startedRef.current = Date.now()
      recorder.start()
      setStartingRecording(false)
      setRecording(true)
      setElapsed(0)
      timerRef.current = window.setInterval(
        () => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)),
        250,
      )
    } catch {
      holdingRef.current = false
      setStartingRecording(false)
      setHint('Microphone unavailable. You can type instead.')
    }
  }

  const stopRecording = () => {
    holdingRef.current = false
    stopTimer()
    setStartingRecording(false)
    if (!recRef.current || recRef.current.state === 'inactive') return
    setRecording(false)
    recRef.current.stop()
  }

  useEffect(
    () => () => {
      stopTimer()
      holdingRef.current = false
      cancelRecordingRef.current = true
      if (recRef.current?.state !== 'inactive') recRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  const resizeTextarea = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }

  return (
    <div className="relative w-full overflow-visible">
      <MathematicalFlameField parameters={flameParameters} pulse={pulse} barRef={formRef} glowRef={glowRef} />
      <button
        type="button"
        onClick={cycleRegime}
        title="Cycle flame regime: auto → 1g earth → 0g microgravity → cool flame"
        className="absolute -top-[19px] right-1 z-20 cursor-pointer rounded-t-md border border-edge/35 bg-[#F4F3EE]/90 px-2 py-0.5 font-mono text-[9px] tracking-[0.015em] text-ink/55 backdrop-blur-sm transition-colors hover:border-accent/60 hover:text-ink/80"
      >
        {`g: ${flameParameters.gravityG.toFixed(2)}g\u00a0 | \u00a0O₂: ${Math.round(flameParameters.o2Pct)}%\u00a0 | \u00a0Re: ${Math.round(flameParameters.airflowCms * 42)}\u00a0 | \u00a0solver: ${flameParameters.coolFlame ? 'cool-flame-720K' : 'curl-eulerian-2d'}`}
      </button>
      <div className="relative">
        <div
          ref={glowRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[26px]"
        />
        <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
        className={`group relative flex items-end gap-2 rounded-[26px] border bg-white/78 p-2 pl-4 shadow-[0_2px_8px_rgba(25,35,45,0.035),0_14px_40px_rgba(25,35,45,0.10)] backdrop-blur-sm transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-accent/65 focus-within:ring-4 focus-within:ring-accent/10 dark:bg-[#151b22]/90 dark:shadow-[0_14px_40px_rgba(0,0,0,0.28)] sm:pl-5 ${
          recording
            ? 'border-red-400/50 bg-red-50/75 dark:bg-red-950/20'
            : 'border-edge/45 hover:border-edge/75'
        }`}
      >
        {recording || startingRecording ? (
          <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-1 font-chat-sans text-sm text-ink/75" role="status" aria-live="polite">
            <span className={`relative flex h-3 w-3 flex-none items-center justify-center rounded-full ${recording ? 'bg-red-500' : 'bg-amber-500'}`}>
              {recording && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40 motion-reduce:animate-none" />}
            </span>
            <span className="min-w-0 truncate">
              {startingRecording ? 'Connecting to microphone…' : `Recording · ${elapsed}s · release to send`}
            </span>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            id="ignis-chat-message"
            aria-label="Message to Ignis"
            rows={1}
            value={text}
            onChange={(event) => {
              const next = event.target.value
              const cursorPosition = event.currentTarget.selectionStart ?? next.length
              setText(next)
              if (
                typeof InputEvent !== 'undefined' &&
                event.nativeEvent instanceof InputEvent &&
                event.nativeEvent.inputType.startsWith('insert')
              ) {
                setPulse((current) => ({
                  id: current.id + 1,
                  position: next.length > 0 ? Math.max(0, Math.min(1, cursorPosition / next.length)) : 0.5,
                }))
              }
              resizeTextarea(event.currentTarget)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            disabled={disabled}
            placeholder="Message Ignis…"
            className="max-h-40 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2.5 font-chat-sans text-base leading-6 text-ink outline-none placeholder:text-ink/45 [scrollbar-width:thin] disabled:cursor-wait disabled:opacity-60"
          />
        )}

        <div className="flex flex-none items-end gap-1.5">
          <button
            type="button"
            aria-label={recording ? 'Release to send voice message' : 'Press and hold to record a voice message'}
            aria-pressed={recording || startingRecording}
            title="Press and hold to talk"
            disabled={disabled}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                // Ignore pointer capture failures on unsupported environments
              }
              void startRecording()
            }}
            onPointerUp={stopRecording}
            onPointerCancel={stopRecording}
            onLostPointerCapture={stopRecording}
            onKeyDown={(event) => {
              if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                event.preventDefault()
                void startRecording()
              }
            }}
            onKeyUp={(event) => {
              if (event.key === ' ' || event.key === 'Enter') stopRecording()
            }}
            onBlur={stopRecording}
            className={`flex h-11 w-11 flex-none touch-none items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${
              recording || startingRecording
                ? 'bg-red-500/12 text-red-600 dark:text-red-300'
                : 'text-ink/55 hover:bg-ink/[0.06] hover:text-ink'
            }`}
          >
            <IconMic size={19} />
          </button>

          <button
            type="submit"
            aria-label="Send message to Ignis"
            disabled={disabled || !text.trim() || recording || startingRecording}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-ink text-bg shadow-sm transition-[background-color,color,transform,opacity] duration-150 hover:bg-accent hover:text-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35"
          >
            <IconSend size={17} />
          </button>
        </div>
        </form>
      </div>

      <div className="min-h-6 px-3 pt-1.5" aria-live="polite">
        {hint && <p className="m-0 font-chat-sans text-sm leading-5 text-ink/65">{hint}</p>}
      </div>
    </div>
  )
}
