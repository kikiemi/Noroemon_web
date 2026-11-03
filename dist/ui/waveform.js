import { ptr_capture } from './dom.js'
import { theme_colors, theme_on_change } from './theme.js'
const MARK_HIT = 8
function layers_build(w) {
  const dpr = window.devicePixelRatio || 1
  const cw = w.canvas.width
  const ch = w.canvas.height
  w.layers_ok = true
  for (const pass of [0, 1]) {
    const lc = pass === 0 ? w.layer_a : w.layer_b
    lc.width = cw
    lc.height = ch
    const c = lc.getContext('2d')
    if (!c || cw <= 0 || ch <= 0) {
      continue
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, cw / dpr, ch / dpr)
    const n = w.peaks.length
    if (n === 0) {
      continue
    }
    const col = theme_colors()
    const vw = cw / dpr
    const vh = ch / dpr
    const mid = vh / 2
    const cols = Math.max(1, Math.floor(vw / 2))
    const bw = vw / cols
    c.fillStyle = pass === 0 ? col.line + '33' : col.accent
    c.beginPath()
    for (let x = 0; x < cols; x++) {
      const i0 = Math.floor((x * n) / cols)
      const i1 = Math.max(i0 + 1, Math.floor(((x + 1) * n) / cols))
      let hi = 0
      let lo = 0
      for (let i = i0; i < i1 && i < n; i++) {
        const p = w.peaks[i] ?? 0
        const q = w.negs[i] ?? 0
        if (p > hi) {
          hi = p
        }
        if (q < lo) {
          lo = q
        }
      }
      const ph = hi * mid * 0.92
      const nh = -lo * mid * 0.92
      c.rect(x * bw, mid - ph, Math.max(bw - 0.6, 0.8), Math.max(ph + nh, 1))
    }
    c.fill()
  }
}
export function wf_draw(w) {
  const c = w.ctx
  const dpr = window.devicePixelRatio || 1
  const cw = w.canvas.width / dpr
  const ch = w.canvas.height / dpr
  if (cw <= 0 || ch <= 0) {
    return
  }
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.clearRect(0, 0, w.canvas.width, w.canvas.height)
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  const col = theme_colors()
  const px = w.dur > 0 ? Math.min(Math.max(w.pos, 0), 1) * cw : 0
  if (w.loop_s >= 0 && w.loop_e > w.loop_s && w.dur > 0) {
    const lx = (w.loop_s / w.dur) * cw
    const rx = (w.loop_e / w.dur) * cw
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
  if (w.peaks.length > 0) {
    if (!w.layers_ok) {
      layers_build(w)
    }
    c.setTransform(1, 0, 0, 1, 0, 0)
    const W = w.canvas.width
    const H = w.canvas.height
    const pxd = Math.round(px * dpr)
    c.drawImage(w.layer_a, 0, 0)
    if (w.mirrored) {
      if (W - pxd > 0) {
        c.drawImage(w.layer_b, pxd, 0, W - pxd, H, pxd, 0, W - pxd, H)
      }
    } else if (pxd > 0) {
      c.drawImage(w.layer_b, 0, 0, pxd, H, 0, 0, pxd, H)
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  if (w.dur > 0 && w.markers.length > 0) {
    c.fillStyle = col.ink
    c.strokeStyle = col.ink
    c.lineWidth = 1.5
    for (const m of w.markers) {
      const x = (m / w.dur) * cw
      c.beginPath()
      c.moveTo(x, 7)
      c.lineTo(x, ch)
      c.stroke()
      c.beginPath()
      c.moveTo(x, 0)
      c.lineTo(x + 4, 4)
      c.lineTo(x, 8)
      c.lineTo(x - 4, 4)
      c.closePath()
      c.fill()
    }
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
export function wf_reset(w, dur) {
  w.dur = dur
  w.peaks = new Float32Array(0)
  w.negs = new Float32Array(0)
  w.layers_ok = false
  wf_draw(w)
}
export function wf_set_peaks(w, mx, mn) {
  w.peaks = mx
  w.negs = mn
  w.layers_ok = false
  wf_draw(w)
}
export function wf_set_pos(w, t) {
  w.pos = t
  wf_draw(w)
}
export function wf_set_loop(w, s, e) {
  w.loop_s = s
  w.loop_e = e
  wf_draw(w)
}
export function wf_clear_loop(w) {
  w.loop_s = -1
  w.loop_e = -1
  wf_draw(w)
}
export function wf_set_markers(w, m) {
  w.markers = [...m]
  wf_draw(w)
}
export function wf_set_mirrored(w, m) {
  w.mirrored = m
  wf_draw(w)
}
function marker_hit(w, cx) {
  if (w.dur <= 0) {
    return -1
  }
  const r = w.canvas.getBoundingClientRect()
  let best = -1
  let bd = MARK_HIT
  for (let i = 0; i < w.markers.length; i++) {
    const x = r.left + ((w.markers[i] ?? 0) / w.dur) * r.width
    const d = Math.abs(cx - x)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}
export function wf_new(parent) {
  const canvas = document.createElement('canvas')
  canvas.className = 'wf-canvas'
  parent.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D が使えません')
  }
  const w = {
    canvas,
    ctx,
    layer_a: document.createElement('canvas'),
    layer_b: document.createElement('canvas'),
    layers_ok: false,
    peaks: new Float32Array(0),
    negs: new Float32Array(0),
    pos: 0,
    dur: 0,
    loop_s: -1,
    loop_e: -1,
    markers: [],
    mirrored: false,
    on_seek: null,
    on_loop: null,
    on_marker_del: null,
  }
  const ro = new ResizeObserver(() => {
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(canvas.clientWidth * dpr)
    canvas.height = Math.round(canvas.clientHeight * dpr)
    w.layers_ok = false
    wf_draw(w)
  })
  ro.observe(canvas)
  theme_on_change(() => {
    w.layers_ok = false
    wf_draw(w)
  })
  let down_x = 0
  let selecting = false
  const view_t = (cx) => {
    const r = canvas.getBoundingClientRect()
    return Math.min(Math.max((cx - r.left) / r.width, 0), 1)
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0) {
      return
    }
    e.preventDefault()
    ptr_capture(canvas, e.pointerId)
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
      const mi = marker_hit(w, e.clientX)
      if (mi >= 0 && w.dur > 0) {
        w.on_seek((w.markers[mi] ?? 0) / w.dur)
      } else {
        w.on_seek(view_t(e.clientX))
      }
    }
    selecting = false
  })
  canvas.addEventListener('pointercancel', (e) => {
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId)
    }
    selecting = false
  })
  canvas.addEventListener('contextmenu', (e) => {
    const mi = marker_hit(w, e.clientX)
    if (mi >= 0 && w.on_marker_del) {
      e.preventDefault()
      w.on_marker_del(mi)
    }
  })
  return w
}
