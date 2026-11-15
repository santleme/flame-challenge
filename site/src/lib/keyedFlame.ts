/**
 * Luminance-keyed video → alpha renderer, shared by every screen that
 * floats NASA combustion footage behind the layout (challenge section,
 * psi-dataset header, simulations deck).
 *
 * Primary path — WebGL. The current video frame uploads as a texture
 * once per *presented* frame and the luma→alpha map runs in the
 * fragment shader: no GPU→CPU readback, no per-pixel JS loop, and the
 * video only decodes while the canvas is on screen.
 *
 * Fallback path — the same math on 2D canvas, still driven by
 * requestVideoFrameCallback (or a currentTime guard under rAF) so it
 * never repaints a frame the decoder already produced.
 *
 * The shader reproduces the original CPU formula exactly:
 *   l = 0.2126 r + 0.7152 g + 0.0722 b   (0..1)
 *   a = clamp((l - 26/255) * 3.4, 0, 1)
 */

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float a = clamp((l - 0.101960784) * 3.4, 0.0, 1.0);
  gl_FragColor = vec4(c.rgb * a, a);
}`

// CPU fallback maps the same (l - 26) * 3.4 clamp through a LUT
const ALPHA_LUT = (() => {
  const t = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) t[i] = (i - 26) * 3.4
  return t
})()

type VideoWithVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (h: number) => void
}

interface GLPipe {
  gl: WebGLRenderingContext
  tex: WebGLTexture
  program: WebGLProgram
  buffer: WebGLBuffer
  attribute: number
}

// React StrictMode mounts effects, cleans them up, then mounts them again
// with the same canvas in development. Keep its WebGL resources with the
// canvas so the second mount can reuse the live context.
const GL_PIPES = new WeakMap<HTMLCanvasElement, GLPipe>()

function initGL(canvas: HTMLCanvasElement): GLPipe | null {
  const cached = GL_PIPES.get(canvas)
  if (cached && !cached.gl.isContextLost()) {
    cached.gl.useProgram(cached.program)
    cached.gl.bindBuffer(cached.gl.ARRAY_BUFFER, cached.buffer)
    cached.gl.enableVertexAttribArray(cached.attribute)
    cached.gl.vertexAttribPointer(cached.attribute, 2, cached.gl.FLOAT, false, 0, 0)
    cached.gl.bindTexture(cached.gl.TEXTURE_2D, cached.tex)
    return cached
  }

  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  })
  if (!gl) return null
  try {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT_SRC))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG_SRC))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
    gl.useProgram(prog)

    // fullscreen quad — two triangles, no per-frame attributes
    const buf = gl.createBuffer()
    if (!buf) throw new Error('no buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )
    const loc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const tex = gl.createTexture()
    if (!tex) throw new Error('no texture')
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // texImage2D sources arrive top-row-first; flip so the quad's
    // bottom-left (0,0) uv maps to the frame's bottom-left
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.clearColor(0, 0, 0, 0)
    const pipe = { gl, tex, program: prog, buffer: buf, attribute: loc }
    GL_PIPES.set(canvas, pipe)
    return pipe
  } catch {
    return null
  }
}

/**
 * Drive the keyed render loop between a hidden <video> and a canvas.
 * Handles visibility (pauses the video off-screen), frame cadence
 * (requestVideoFrameCallback when available) and an optional loop
 * window — `loop` seeks back to `start` whenever playback reaches
 * `end` (or the clip ends), so a segment keeps cycling. Returns a
 * cleanup.
 */
export function attachKeyedFlame(
  video: VideoWithVFC,
  canvas: HTMLCanvasElement,
  loop?: { start: number; end: number },
): () => void {
  // runtime feature-detect — the DOM types claim the methods always
  // exist, but older browsers genuinely lack them (rAF fallback below)
  const vfc =
    typeof video.requestVideoFrameCallback === 'function'
      ? video.requestVideoFrameCallback.bind(video)
      : undefined
  const cvfc =
    typeof video.cancelVideoFrameCallback === 'function'
      ? video.cancelVideoFrameCallback.bind(video)
      : undefined
  let pipe = initGL(canvas)
  // 2D fallback context — created only when WebGL is unavailable
  const ctx2d = pipe
    ? null
    : canvas.getContext('2d', { willReadFrequently: true })

  let cancelled = false
  let visible = true
  let raf = 0
  let vfch = 0
  let lastTime = -1
  let lastW = 0
  let lastH = 0

  const drawGL = (w: number, h: number) => {
    const { gl, tex } = pipe!
    gl.viewport(0, 0, w, h)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  const draw2D = (w: number, h: number) => {
    const ctx = ctx2d!
    ctx.drawImage(video, 0, 0, w, h)
    const img = ctx.getImageData(0, 0, w, h)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) | 0
      d[i + 3] = ALPHA_LUT[l]
    }
    ctx.putImageData(img, 0, 0)
  }

  const pump = () => {
    if (cancelled) return
    if (visible && video.readyState >= 2 && video.videoWidth) {
      const w = Math.max(1, video.videoWidth >> 1)
      const h = Math.max(1, video.videoHeight >> 1)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        lastTime = -1 // a resize must repaint even on the same frame
      }
      // repaint only when the decoder actually advanced — under rAF this
      // dedups the redundant redraws; under rVFC it's nearly free
      if (video.currentTime !== lastTime || w !== lastW || h !== lastH) {
        try {
          if (pipe) drawGL(w, h)
          else if (ctx2d) draw2D(w, h)
          lastTime = video.currentTime
          lastW = w
          lastH = h
        } catch {
          // a context that dies mid-run falls back to the 2D path once
          pipe = null
        }
      }
    }
    if (vfc) vfch = vfc(pump)
    else raf = requestAnimationFrame(pump)
  }

  const obs = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      if (visible) {
        void video.play().catch(() => {})
      } else {
        video.pause()
      }
    },
    { threshold: 0 },
  )
  obs.observe(canvas)

  let onLoadedMetadata: (() => void) | undefined
  let onTimeUpdate: (() => void) | undefined
  let onEnded: (() => void) | undefined
  if (loop) {
    onLoadedMetadata = () => {
      video.currentTime = loop.start
    }
    onTimeUpdate = () => {
      if (video.currentTime >= loop.end) video.currentTime = loop.start
    }
    onEnded = () => {
      video.currentTime = loop.start
      void video.play().catch(() => {})
    }
    video.addEventListener('loadedmetadata', onLoadedMetadata)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    // metadata can already be in before attach runs — loadedmetadata
    // only fires once, so apply the window start eagerly in that case
    if (video.readyState >= 1) video.currentTime = loop.start
  }

  if (vfc) vfch = vfc(pump)
  else raf = requestAnimationFrame(pump)

  return () => {
    cancelled = true
    cancelAnimationFrame(raf)
    if (vfc && cvfc) cvfc(vfch)
    obs.disconnect()
    if (onLoadedMetadata)
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
    if (onTimeUpdate)
      video.removeEventListener('timeupdate', onTimeUpdate)
    if (onEnded) video.removeEventListener('ended', onEnded)
    // Do not force-lose the canvas context here: StrictMode immediately
    // re-runs this effect, and a lost WebGL context cannot switch to 2D.
    pipe = null
  }
}
