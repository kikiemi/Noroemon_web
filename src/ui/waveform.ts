import { theme_colors, theme_on_change } from './theme.js'

export type wf_t = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  peaks: Float32Array
  negs: Float32Array
  pos: number
  dur: number
  loop_s: number
  loop_e: number
  mirrored: boolean
  worker: Worker | null
  on_seek: ((t: number) => void) | null
  on_loop: ((s: number, e: number) => void) | null
}

const PEAK_WORKER_SRC = `
'use strict'
self.onmessage = function (e) {
  var data = e.data,
    buckets = 1024
  var per = Math.floor(data.length / buckets) || 1
  var peaks = new Float32Array(buckets)
  var negs = new Float32Array(buckets)
  for (var i = 0; i < buckets; i++) {
    var mx = 0,
      mn = 0,
      st = i * per
    var end = Math.min(st + per, data.length)
    for (var j = st; j < end; j++) {
      var v = data[j]
      if (v > mx) {
        mx = v
      }
      if (v < mn) {
        mn = v
      }
    }
    peaks[i] = mx
    negs[i] = mn
  }
  self.postMessage({ peaks: peaks, negs: negs }, [peaks.buffer, negs.buffer])
}
`

function to_view(w: wf_t, t: number): number {
  return w.mirrored ? 1 - t : t
}

export function wf_draw(w: wf_t): void {
  const c = w.ctx
  const dpr = window.devicePixelRatio || 1
  const cw = w.canvas.width / dpr
  const ch = w.canvas.height / dpr
  if (cw <= 0 || ch <= 0) {
    return
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, cw, ch)
  if (w.peaks.length === 0) {
    return
  }

  const col = theme_colors()
  const mid = ch / 2
  const n = w.peaks.length
  const bw = cw / n
  const view_pos = to_view(w, w.pos)
  const px = view_pos * cw

  if (w.loop_s >= 0 && w.loop_e > w.loop_s && w.dur > 0) {
    let lx = to_view(w, w.loop_s / w.dur) * cw
    let rx = to_view(w, w.loop_e / w.dur) * cw
    if (lx > rx) {
      const t = lx
      lx = rx
      rx = t
    }
    c.fillStyle = col.accent_soft
    c.fillRect(lx, 0, rx - lx, ch)
    c.strokeStyle = col.accent
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(lx, 0)
    c.lineTo(lx, ch)
    c.moveTo(rx, 0)
    c.lineTo(rx, ch)
    c.stroke()
  }

  for (let pass = 0; pass < 2; pass++) {
    c.fillStyle = pass === 0 ? col.line + '33' : col.accent
    c.beginPath()
    for (let i = 0; i < n; i++) {
      const x = i * bw
      const played = w.mirrored ? x + bw > px : x < px
      if ((pass === 1) !== played) {
        continue
      }
      const ph = w.peaks[i] * mid * 0.92
      const nh = -w.negs[i] * mid * 0.92
      c.rect(x, mid - ph, Math.max(bw - 1, 1), Math.max(ph + nh, 1))
    }
    c.fill()
  }

  c.strokeStyle = col.panel
  c.lineWidth = 5
  c.beginPath()
  c.moveTo(px, 0)
  c.lineTo(px, ch)
  c.stroke()
  c.strokeStyle = col.ink
  c.lineWidth = 2.5
  c.beginPath()
  c.moveTo(px, 0)
  c.lineTo(px, ch)
  c.stroke()
}

export function wf_set_buffer(w: wf_t, buf: AudioBuffer): void {
  w.dur = buf.duration
  w.peaks = new Float32Array(0)
  w.negs = new Float32Array(0)
  wf_draw(w)

  if (w.worker) {
    w.worker.terminate()
    w.worker = null
  }
  const blob = new Blob([PEAK_WORKER_SRC], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  const wk = new Worker(url)
  URL.revokeObjectURL(url)
  w.worker = wk
  const copy = buf.getChannelData(0).slice()
  wk.postMessage(copy, [copy.buffer])
  wk.onmessage = (e: MessageEvent) => {
    const d = e.data as {
      peaks: Float32Array
      negs: Float32Array
    }
    w.peaks = d.peaks
    w.negs = d.negs
    wf_draw(w)
    wk.terminate()
    if (w.worker === wk) {
      w.worker = null
    }
  }
}

export function wf_set_pos(w: wf_t, t: number): void {
  w.pos = t
  wf_draw(w)
}

export function wf_set_loop(w: wf_t, s: number, e: number): void {
  w.loop_s = s
  w.loop_e = e
  wf_draw(w)
}

export function wf_clear_loop(w: wf_t): void {
  w.loop_s = -1
  w.loop_e = -1
  wf_draw(w)
}

export function wf_set_mirrored(w: wf_t, m: boolean): void {
  w.mirrored = m
  wf_draw(w)
}

export function wf_new(parent: HTMLElement): wf_t {
  const canvas = document.createElement('canvas')
  canvas.className = 'wf-canvas'
  parent.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const w: wf_t = {
    canvas,
    ctx: ctx as CanvasRenderingContext2D,
    peaks: new Float32Array(0),
    negs: new Float32Array(0),
    pos: 0,
    dur: 0,
    loop_s: -1,
    loop_e: -1,
    mirrored: false,
    worker: null,
    on_seek: null,
    on_loop: null,
  }

  const ro = new ResizeObserver(() => {
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
    wf_draw(w)
  })
  ro.observe(canvas)
  theme_on_change(() => wf_draw(w))

  let down_x = 0
  let selecting = false
  const view_t = (cx: number): number => {
    const r = canvas.getBoundingClientRect()
    const t = Math.min(Math.max((cx - r.left) / r.width, 0), 1)
    return w.mirrored ? 1 - t : t
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    down_x = e.clientX
    selecting = false
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!canvas.hasPointerCapture(e.pointerId)) {
      return
    }
    if (!selecting && Math.abs(e.clientX - down_x) > 6) {
      selecting = true
    }
    if (selecting && w.dur > 0) {
      const a = view_t(down_x) * w.dur
      const b = view_t(e.clientX) * w.dur
      w.loop_s = Math.min(a, b)
      w.loop_e = Math.max(a, b)
      wf_draw(w)
    }
  })
  canvas.addEventListener('pointerup', (e) => {
    if (!canvas.hasPointerCapture(e.pointerId)) {
      return
    }
    canvas.releasePointerCapture(e.pointerId)
    if (selecting) {
      if (w.loop_e > w.loop_s && w.on_loop) {
        w.on_loop(w.loop_s, w.loop_e)
      }
    } else if (w.on_seek) {
      w.on_seek(view_t(e.clientX))
    }
    selecting = false
  })
  canvas.addEventListener('pointercancel', (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId)
    }
    selecting = false
  })

  return w
}
