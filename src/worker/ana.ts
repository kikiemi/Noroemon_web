import { fft_new, rfft, hann_periodic } from './fft.js'

const PEAK_N = 2048
const DEC = 4

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function ana_peaks(chs: Float32Array[], len: number): { mx: Float32Array; mn: Float32Array } {
  const mx = new Float32Array(PEAK_N)
  const mn = new Float32Array(PEAK_N)
  const per = len / PEAK_N
  for (let b = 0; b < PEAK_N; b++) {
    const s0 = Math.floor(b * per)
    let s1 = Math.floor((b + 1) * per)
    if (s1 <= s0) {
      s1 = s0 + 1
    }
    if (s1 > len) {
      s1 = len
    }
    let hi = 0
    let lo = 0
    for (const x of chs) {
      for (let i = s0; i < s1; i++) {
        const v = x[i]
        if (v > hi) {
          hi = v
        } else if (v < lo) {
          lo = v
        }
      }
    }
    mx[b] = hi
    mn[b] = lo
  }
  return { mx, mn }
}

type biq_t = { b0: number; b1: number; b2: number; a1: number; a2: number }

function kweight(sr: number): biq_t[] {
  let f0 = 1681.974450955533
  const g = 3.999843853973347
  let q = 0.7071752369554196
  let k = Math.tan((Math.PI * f0) / sr)
  const vh = Math.pow(10, g / 20)
  const vb = Math.pow(vh, 0.4996667741545416)
  let a0 = 1 + k / q + k * k
  const pre: biq_t = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  }
  f0 = 38.13547087602444
  q = 0.5003270373238773
  k = Math.tan((Math.PI * f0) / sr)
  a0 = 1 + k / q + k * k
  const rlb: biq_t = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  }
  return [pre, rlb]
}

function ana_loudness(
  chs: Float32Array[],
  len: number,
  sr: number,
): { lufs: number; peak: number } {
  const fl = kweight(sr)
  const step = Math.round(sr * 0.1)
  const n_steps = Math.floor(len / step)
  const acc = new Float64Array(n_steps)
  let peak = 0
  for (const x of chs) {
    let z1a = 0
    let z2a = 0
    let z1b = 0
    let z2b = 0
    const a = fl[0]
    const b = fl[1]
    for (let s = 0; s < n_steps; s++) {
      let sum = 0
      const o = s * step
      for (let i = 0; i < step; i++) {
        const v = x[o + i]
        const av = v < 0 ? -v : v
        if (av > peak) {
          peak = av
        }
        const y1 = a.b0 * v + z1a
        z1a = a.b1 * v - a.a1 * y1 + z2a
        z2a = a.b2 * v - a.a2 * y1
        const y2 = b.b0 * y1 + z1b
        z1b = b.b1 * y1 - b.a1 * y2 + z2b
        z2b = b.b2 * y1 - b.a2 * y2
        sum += y2 * y2
      }
      acc[s] += sum
    }
  }
  const n_blk = n_steps - 3
  if (n_blk <= 0) {
    return { lufs: -70, peak }
  }
  const blk = new Float64Array(n_blk)
  const bs = step * 4
  for (let i = 0; i < n_blk; i++) {
    blk[i] = (acc[i] + acc[i + 1] + acc[i + 2] + acc[i + 3]) / bs
  }
  const abs_gate = Math.pow(10, (-70 + 0.691) / 10)
  let s1 = 0
  let c1 = 0
  for (let i = 0; i < n_blk; i++) {
    if (blk[i] > abs_gate) {
      s1 += blk[i]
      c1++
    }
  }
  if (c1 === 0) {
    return { lufs: -70, peak }
  }
  const rel_gate = (s1 / c1) * Math.pow(10, -1)
  let s2 = 0
  let c2 = 0
  for (let i = 0; i < n_blk; i++) {
    if (blk[i] > abs_gate && blk[i] > rel_gate) {
      s2 += blk[i]
      c2++
    }
  }
  const lufs = c2 > 0 ? -0.691 + 10 * Math.log10(s2 / c2) : -70
  return { lufs, peak }
}

function ana_decimate(
  chs: Float32Array[],
  len: number,
  sr: number,
): { x: Float32Array; sr: number } {
  const taps = 63
  const h = new Float64Array(taps)
  const fc = 0.9 / DEC / 2
  let sum = 0
  for (let i = 0; i < taps; i++) {
    const t = i - (taps - 1) / 2
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) +
      0.08 * Math.cos((4 * Math.PI * i) / (taps - 1))
    const s = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t)
    h[i] = s * w
    sum += h[i]
  }
  for (let i = 0; i < taps; i++) {
    h[i] /= sum
  }
  const n = Math.floor(len / DEC)
  const out = new Float32Array(n)
  const nc = chs.length
  const half = (taps - 1) >> 1
  for (let j = 0; j < n; j++) {
    const c = j * DEC
    let acc = 0
    for (let i = 0; i < taps; i++) {
      const p = c + i - half
      if (p < 0 || p >= len) {
        continue
      }
      let v = 0
      for (let k = 0; k < nc; k++) {
        v += chs[k][p]
      }
      acc += h[i] * v
    }
    out[j] = acc / nc
  }
  return { x: out, sr: sr / DEC }
}

function ana_tempo(x: Float32Array, sr: number): { bpm: number; beat: number } {
  const n_fft = 1024
  const hop = 128
  const len = x.length
  const max_frames = Math.floor((sr * 150) / hop)
  let start = 0
  let n_frames = Math.floor((len - n_fft) / hop)
  if (n_frames > max_frames) {
    start = Math.floor(((n_frames - max_frames) * hop) / 2)
    start -= start % hop
    n_frames = max_frames
  }
  if (n_frames < 64) {
    return { bpm: 0, beat: 0 }
  }
  const f = fft_new(n_fft)
  const win = hann_periodic(n_fft)
  const buf = new Float64Array(n_fft)
  const spr = new Float64Array(n_fft / 2 + 1)
  const spi = new Float64Array(n_fft / 2 + 1)
  const prev = new Float64Array(n_fft / 2 + 1)
  const onset = new Float64Array(n_frames)
  const kmax =
    Math.floor((8000 * n_fft) / sr) < n_fft / 2 ? Math.floor((8000 * n_fft) / sr) : n_fft / 2
  for (let t = 0; t < n_frames; t++) {
    const o = start + t * hop
    for (let i = 0; i < n_fft; i++) {
      buf[i] = x[o + i] * win[i]
    }
    rfft(f, buf, spr, spi)
    let flux = 0
    for (let k = 1; k <= kmax; k++) {
      const m = Math.log1p(1000 * Math.sqrt(spr[k] * spr[k] + spi[k] * spi[k]))
      const d = m - prev[k]
      if (d > 0) {
        flux += d
      }
      prev[k] = m
    }
    onset[t] = t === 0 ? 0 : flux
  }
  const wl = 16
  const sm = new Float64Array(n_frames)
  let run = 0
  for (let t = 0; t < n_frames; t++) {
    run += onset[t]
    if (t >= wl) {
      run -= onset[t - wl]
    }
    const mean = run / Math.min(t + 1, wl)
    const v = onset[t] - mean
    sm[t] = v > 0 ? v : 0
  }
  const fps = sr / hop
  const lag_min = Math.floor((60 * fps) / 210)
  const lag_max = Math.ceil((60 * fps) / 55)
  const score = new Float64Array(lag_max + 2)
  let best = -1
  let best_lag = lag_min
  for (let lag = lag_min; lag <= lag_max + 1; lag++) {
    let s = 0
    for (let t = 0; t + lag < n_frames; t++) {
      s += sm[t] * sm[t + lag]
    }
    s /= n_frames - lag
    score[lag] = s
  }
  for (let lag = lag_min + 1; lag <= lag_max; lag++) {
    const bpm = (60 * fps) / lag
    const lg = Math.log2(bpm / 120)
    const prior = Math.exp(-0.5 * lg * lg)
    let s = score[lag]
    const l2 = lag * 2
    if (l2 <= lag_max) {
      s += 0.5 * score[l2]
    }
    const lh = Math.round(lag / 2)
    if (lh >= lag_min) {
      s += 0.25 * score[lh]
    }
    s *= prior
    if (s > best) {
      best = s
      best_lag = lag
    }
  }
  let refined = best_lag
  const y0 = score[best_lag - 1]
  const y1 = score[best_lag]
  const y2 = score[best_lag + 1]
  const den = y0 - 2 * y1 + y2
  if (den < 0) {
    const d = (0.5 * (y0 - y2)) / den
    if (d > -1 && d < 1) {
      refined = best_lag + d
    }
  }
  const period = refined
  const bpm = (60 * fps) / period
  const n_ph = Math.max(1, Math.round(period * 4))
  let bp = 0
  let bv = -1
  for (let p = 0; p < n_ph; p++) {
    const ph = (p / n_ph) * period
    let s = 0
    for (let pos = ph; pos < n_frames - 1; pos += period) {
      const i = Math.floor(pos)
      const fr = pos - i
      s += sm[i] * (1 - fr) + sm[i + 1] * fr
    }
    if (s > bv) {
      bv = s
      bp = ph
    }
  }
  const per_sec = 60 / bpm
  let beat = (start + bp * hop + n_fft / 2) / sr
  beat -= Math.floor(beat / per_sec) * per_sec
  return { bpm: Math.round(bpm * 10) / 10, beat }
}

function ana_key(x: Float32Array, sr: number): { key: number; conf: number } {
  const n_fft = 8192
  const hop = 4096
  const len = x.length
  const n_frames = Math.floor((len - n_fft) / hop)
  if (n_frames < 4) {
    return { key: -1, conf: 0 }
  }
  const f = fft_new(n_fft)
  const win = hann_periodic(n_fft)
  const buf = new Float64Array(n_fft)
  const spr = new Float64Array(n_fft / 2 + 1)
  const spi = new Float64Array(n_fft / 2 + 1)
  const k_lo = Math.ceil((55 * n_fft) / sr)
  const k_hi = Math.min(n_fft / 2 - 1, Math.floor((2000 * n_fft) / sr))
  const pc = new Int8Array(k_hi + 1)
  const wt = new Float64Array(k_hi + 1)
  for (let k = k_lo; k <= k_hi; k++) {
    const hz = (k * sr) / n_fft
    const midi = 69 + 12 * Math.log2(hz / 440)
    const near = Math.round(midi)
    const dev = Math.abs(midi - near)
    pc[k] = ((near % 12) + 12) % 12
    wt[k] = dev < 0.5 ? Math.cos(Math.PI * dev) ** 2 : 0
  }
  const chroma = new Float64Array(12)
  const frame = new Float64Array(12)
  for (let t = 0; t < n_frames; t++) {
    const o = t * hop
    for (let i = 0; i < n_fft; i++) {
      buf[i] = x[o + i] * win[i]
    }
    rfft(f, buf, spr, spi)
    frame.fill(0)
    for (let k = k_lo; k <= k_hi; k++) {
      const m = Math.sqrt(spr[k] * spr[k] + spi[k] * spi[k])
      frame[pc[k]] += Math.log1p(100 * m) * wt[k]
    }
    let mx = 0
    for (let c = 0; c < 12; c++) {
      if (frame[c] > mx) {
        mx = frame[c]
      }
    }
    if (mx > 1e-6) {
      for (let c = 0; c < 12; c++) {
        chroma[c] += frame[c] / mx
      }
    }
  }
  const corr = (prof: readonly number[], rot: number): number => {
    let ma = 0
    let mb = 0
    for (let i = 0; i < 12; i++) {
      ma += chroma[(i + rot) % 12]
      mb += prof[i]
    }
    ma /= 12
    mb /= 12
    let num = 0
    let da = 0
    let db = 0
    for (let i = 0; i < 12; i++) {
      const a = chroma[(i + rot) % 12] - ma
      const b = prof[i] - mb
      num += a * b
      da += a * a
      db += b * b
    }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
  }
  let best = -2
  let second = -2
  let key = -1
  for (let r = 0; r < 12; r++) {
    const vs = [corr(KK_MAJOR, r), corr(KK_MINOR, r)]
    for (let m = 0; m < 2; m++) {
      const v = vs[m] ?? -2
      if (v > best) {
        second = best
        best = v
        key = r + m * 12
      } else if (v > second) {
        second = v
      }
    }
  }
  return { key, conf: best - second }
}

function f32_arr(v: unknown): Float32Array[] | null {
  if (!Array.isArray(v)) {
    return null
  }
  const out: Float32Array[] = []
  for (const x of v) {
    if (!(x instanceof Float32Array)) {
      return null
    }
    out.push(x)
  }
  return out
}

self.onmessage = (e: MessageEvent<unknown>): void => {
  const d = e.data
  if (typeof d !== 'object' || d === null) {
    return
  }
  const chs = f32_arr(Reflect.get(d, 'ch'))
  const sr_v: unknown = Reflect.get(d, 'sr')
  const job_v: unknown = Reflect.get(d, 'job')
  const want_v: unknown = Reflect.get(d, 'want')
  if (!chs || chs.length === 0 || typeof sr_v !== 'number' || !(sr_v > 0)) {
    return
  }
  const job = typeof job_v === 'number' ? job_v : 0
  const want_all = want_v !== 'peaks'
  const len = chs[0].length
  for (const c of chs) {
    if (c.length !== len) {
      return
    }
  }
  const pk = ana_peaks(chs, len)
  postMessage({ type: 'peaks', job, mx: pk.mx, mn: pk.mn }, [pk.mx.buffer, pk.mn.buffer])
  if (!want_all) {
    return
  }
  const ld = ana_loudness(chs, len, sr_v)
  const dec = ana_decimate(chs, len, sr_v)
  const tp = ana_tempo(dec.x, dec.sr)
  const ky = ana_key(dec.x, dec.sr)
  postMessage({
    type: 'info',
    job,
    lufs: ld.lufs,
    peak: ld.peak,
    bpm: tp.bpm,
    beat: tp.beat,
    key: ky.key,
    key_conf: ky.conf,
  })
}
