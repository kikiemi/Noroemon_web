import { theme_colors, theme_on_change } from './theme.js'
import { VIZ_BARS, VIZ_WAVE } from '../types.js'
const N_BARS = 48
const PEAK_FALL = 0.008
function vz_build_bands(v, n_bins) {
  const lo_bin = 2
  const hi_bin = Math.min(n_bins - 1, Math.floor(n_bins * (16000 / 22050)))
  for (let i = 0; i < N_BARS; i++) {
    const f0 = lo_bin * Math.pow(hi_bin / lo_bin, i / N_BARS)
    const f1 = lo_bin * Math.pow(hi_bin / lo_bin, (i + 1) / N_BARS)
    v.band_lo[i] = Math.floor(f0)
    v.band_hi[i] = Math.max(Math.floor(f0) + 1, Math.floor(f1))
  }
}
function vz_draw(v) {
  const c = v.ctx
  const dpr = window.devicePixelRatio || 1
  const w = v.canvas.width / dpr
  const h = v.canvas.height / dpr
  if (w <= 0 || h <= 0) {
    return
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.clearRect(0, 0, w, h)
  const col = theme_colors()
  if (v.mode === VIZ_WAVE) {
    c.strokeStyle = col.accent
    c.lineWidth = 3
    c.lineJoin = 'round'
    c.lineCap = 'round'
    c.beginPath()
    const n = v.time.length
    const step = Math.max(1, (n / 256) | 0)
    for (let i = 0, x = 0; i < n; i += step, x++) {
      const y = h / 2 + ((v.time[i] - 128) / 128) * h * 0.42
      const px = (i / n) * w
      if (x === 0) {
        c.moveTo(px, y)
      } else {
        c.lineTo(px, y)
      }
    }
    c.stroke()
    return
  }
  const gap = 3
  const bw = (w - gap * (N_BARS - 1)) / N_BARS
  if (bw <= 0) {
    return
  }
  c.fillStyle = col.accent
  c.beginPath()
  for (let i = 0; i < N_BARS; i++) {
    const bh = Math.max(3, v.bars[i] * (h - 8))
    const x = i * (bw + gap)
    const y = h - bh
    const r = Math.max(0, Math.min(bw / 2, 4))
    c.moveTo(x + r, y)
    c.arcTo(x + bw, y, x + bw, y + bh, r)
    c.lineTo(x + bw, h)
    c.lineTo(x, h)
    c.arcTo(x, y, x + r, y, r)
  }
  c.fill()
  c.fillStyle = col.ink
  for (let i = 0; i < N_BARS; i++) {
    const py = h - 8 - v.peaks[i] * (h - 8)
    const x = i * (bw + gap)
    c.fillRect(x, py, bw, 3)
  }
}
function vz_tick(v) {
  v.raf = 0
  if (!v.playing || document.hidden || !v.analyser) {
    return
  }
  v.analyser.getByteFrequencyData(v.freq)
  if (v.mode === VIZ_WAVE) {
    v.analyser.getByteTimeDomainData(v.time)
  } else {
    for (let i = 0; i < N_BARS; i++) {
      let sum = 0
      const lo = v.band_lo[i],
        hi = v.band_hi[i]
      for (let b = lo; b < hi; b++) {
        sum += v.freq[b]
      }
      const val = sum / ((hi - lo) * 255)
      v.bars[i] = val > v.bars[i] ? val : v.bars[i] * 0.82 + val * 0.18
      if (v.bars[i] > v.peaks[i]) {
        v.peaks[i] = v.bars[i]
      } else {
        v.peaks[i] = Math.max(0, v.peaks[i] - PEAK_FALL)
      }
    }
  }
  vz_draw(v)
  v.raf = requestAnimationFrame(() => vz_tick(v))
}
export function vz_set_playing(v, on) {
  v.playing = on
  if (on && !v.raf && !document.hidden) {
    v.raf = requestAnimationFrame(() => vz_tick(v))
  }
  if (!on) {
    for (let i = 0; i < N_BARS; i++) {
      v.bars[i] *= 0.3
    }
    vz_draw(v)
  }
}
export function vz_set_mode(v, m) {
  v.mode = m
  vz_draw(v)
}
export function vz_connect(v, analyser) {
  v.analyser = analyser
  v.freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
  v.time = new Uint8Array(new ArrayBuffer(analyser.fftSize))
  vz_build_bands(v, analyser.frequencyBinCount)
}
export function vz_new(parent) {
  const canvas = document.createElement('canvas')
  canvas.className = 'vz-canvas'
  parent.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D が使えません')
  }
  const v = {
    canvas,
    ctx,
    analyser: null,
    freq: new Uint8Array(new ArrayBuffer(0)),
    time: new Uint8Array(new ArrayBuffer(0)),
    band_lo: new Int32Array(N_BARS),
    band_hi: new Int32Array(N_BARS),
    bars: new Float32Array(N_BARS),
    peaks: new Float32Array(N_BARS),
    mode: VIZ_BARS,
    playing: false,
    raf: 0,
  }
  const resize = () => {
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
    vz_draw(v)
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()
  theme_on_change(() => vz_draw(v))
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && v.playing && !v.raf) {
      v.raf = requestAnimationFrame(() => vz_tick(v))
    }
  })
  canvas.addEventListener('click', () => {
    vz_set_mode(v, v.mode === VIZ_BARS ? VIZ_WAVE : VIZ_BARS)
  })
  return v
}
