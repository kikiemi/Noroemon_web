declare const sampleRate: number

type wport_t = {
  postMessage(msg: unknown): void
  onmessage: ((ev: { data: unknown }) => void) | null
}

declare class AudioWorkletProcessor {
  readonly port: wport_t
}

declare function registerProcessor(
  name: string,
  ctor: new (opts: unknown) => AudioWorkletProcessor,
): void

const TWO_PI = Math.PI * 2
const N_HI = 2048
const N_LO = 4096
const SYN_HOP = 512
const OFS = 1536
const LO_PRE = (N_LO - N_HI) >> 1
const START = OFS + LO_PRE
const OLA_NORM = 1.5
const RING = 1 << 15
const RING_M = RING - 1
const MAX_GRAINS = 64
const REPORT_EVERY = 2048
const RS_TAPS = 64
const RS_HALF = 32
const RS_PH = 512
const BFP_SHIFT = 10
const FADE_N = 96
const TE_ITER = 6
const XO_LO = 2000
const XO_HI = 3000

const RS_TAB = new Float32Array((RS_PH + 1) * RS_TAPS)

function bessel_i0(x: number): number {
  let sum = 1
  let term = 1
  const q = (x * x) / 4
  for (let k = 1; k < 64; k++) {
    term *= q / (k * k)
    sum += term
    if (term < sum * 1e-12) {
      break
    }
  }
  return sum
}

function rs_build(): void {
  const beta = 8.0
  const fc = 0.915
  const i0b = bessel_i0(beta)
  for (let p = 0; p <= RS_PH; p++) {
    const frac = p / RS_PH
    let sum = 0
    for (let j = 0; j < RS_TAPS; j++) {
      const x = j - RS_HALF + 1 - frac
      const t = x / RS_HALF
      let w = 0
      if (t > -1 && t < 1) {
        w = bessel_i0(beta * Math.sqrt(1 - t * t)) / i0b
      }
      const a = Math.PI * fc * x
      const s = Math.abs(a) < 1e-9 ? 1 : Math.sin(a) / a
      const h = fc * s * w
      RS_TAB[p * RS_TAPS + j] = h
      sum += h
    }
    for (let j = 0; j < RS_TAPS; j++) {
      RS_TAB[p * RS_TAPS + j] /= sum
    }
  }
}
rs_build()

type fftp_t = {
  n: number
  half: number
  m: number
  rev: Uint16Array
  tw_re: Float64Array
  tw_im: Float64Array
  uf_re: Float64Array
  uf_im: Float64Array
  w_re: Float64Array
  w_im: Float64Array
  hann: Float64Array
  hann_s: Float64Array
  hann_a: Float64Array
}

function fftp_new(n: number): fftp_t {
  const m = n >> 1
  let bits = 0
  while (1 << bits < m) {
    bits++
  }
  const p: fftp_t = {
    n,
    half: m,
    m,
    rev: new Uint16Array(m),
    tw_re: new Float64Array(m >> 1),
    tw_im: new Float64Array(m >> 1),
    uf_re: new Float64Array(m),
    uf_im: new Float64Array(m),
    w_re: new Float64Array(m),
    w_im: new Float64Array(m),
    hann: new Float64Array(n),
    hann_s: new Float64Array(n),
    hann_a: new Float64Array(n),
  }
  for (let i = 0; i < m; i++) {
    let r = 0
    let x = i
    for (let k = 0; k < bits; k++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    p.rev[i] = r
  }
  for (let k = 0; k < m >> 1; k++) {
    const a = (-TWO_PI * k) / m
    p.tw_re[k] = Math.cos(a)
    p.tw_im[k] = Math.sin(a)
  }
  for (let k = 0; k < m; k++) {
    const a = (-TWO_PI * k) / n
    p.uf_re[k] = Math.cos(a)
    p.uf_im[k] = Math.sin(a)
  }
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((TWO_PI * i) / n))
    p.hann[i] = w
    p.hann_s[i] = w / OLA_NORM
    p.hann_a[i] = (w * w) / OLA_NORM
  }
  return p
}

function fft_m(p: fftp_t, re: Float64Array, im: Float64Array): void {
  const m = p.m
  const rev = p.rev
  for (let i = 0; i < m; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  const twr = p.tw_re
  const twi = p.tw_im
  for (let s = 1; s < m; s <<= 1) {
    const stride = (m >> 1) / s
    for (let k = 0; k < m; k += s << 1) {
      for (let j = 0; j < s; j++) {
        const tw = j * stride
        const wr = twr[tw]
        const wi = twi[tw]
        const u = k + j
        const v = u + s
        const tr = wr * re[v] - wi * im[v]
        const ti = wr * im[v] + wi * re[v]
        re[v] = re[u] - tr
        im[v] = im[u] - ti
        re[u] += tr
        im[u] += ti
      }
    }
  }
}

function rfft_fwd(p: fftp_t, x: Float64Array, spr: Float64Array, spi: Float64Array): void {
  const m = p.m
  const wr = p.w_re
  const wi = p.w_im
  for (let k = 0; k < m; k++) {
    wr[k] = x[2 * k]
    wi[k] = x[2 * k + 1]
  }
  fft_m(p, wr, wi)
  spr[0] = wr[0] + wi[0]
  spi[0] = 0
  spr[m] = wr[0] - wi[0]
  spi[m] = 0
  const ufr = p.uf_re
  const ufi = p.uf_im
  for (let k = 1; k < m; k++) {
    const ar = wr[k]
    const ai = wi[k]
    const br = wr[m - k]
    const bi = -wi[m - k]
    const fer = (ar + br) * 0.5
    const fei = (ai + bi) * 0.5
    const fo_r = (ar - br) * 0.5
    const fo_i = (ai - bi) * 0.5
    const tr = ufr[k] * fo_r - ufi[k] * fo_i
    const ti = ufr[k] * fo_i + ufi[k] * fo_r
    spr[k] = fer + ti
    spi[k] = fei - tr
  }
}

function rfft_inv(p: fftp_t, spr: Float64Array, spi: Float64Array, x: Float64Array): void {
  const m = p.m
  const wr = p.w_re
  const wi = p.w_im
  const ufr = p.uf_re
  const ufi = p.uf_im
  for (let k = 0; k < m; k++) {
    let ar: number
    let ai: number
    let br: number
    let bi: number
    if (k === 0) {
      ar = spr[0]
      ai = 0
      br = spr[m]
      bi = 0
    } else {
      ar = spr[k]
      ai = spi[k]
      br = spr[m - k]
      bi = -spi[m - k]
    }
    const fer = (ar + br) * 0.5
    const fei = (ai + bi) * 0.5
    const fo_r = (ar - br) * 0.5
    const fo_i = (ai - bi) * 0.5
    const wcr = ufr[k]
    const wci = -ufi[k]
    const tr = wcr * fo_r - wci * fo_i
    const ti = wcr * fo_i + wci * fo_r
    wr[k] = fer - ti
    wi[k] = -(fei + tr)
  }
  fft_m(p, wr, wi)
  const inv = 1 / m
  for (let k = 0; k < m; k++) {
    x[2 * k] = wr[k] * inv
    x[2 * k + 1] = -wi[k] * inv
  }
}

function princ(a: number): number {
  return a - TWO_PI * Math.round(a / TWO_PI)
}

function field(o: object, k: string): unknown {
  return Reflect.get(o, k)
}

function f_num(o: object, k: string, def: number): number {
  const v = field(o, k)
  return typeof v === 'number' && Number.isFinite(v) ? v : def
}

function f_clamp(o: object, k: string, def: number, lo: number, hi: number): number {
  const v = f_num(o, k, def)
  return v < lo ? lo : v > hi ? hi : v
}

function msg_type(d: unknown): { o: object; t: string } | null {
  if (typeof d !== 'object' || d === null) {
    return null
  }
  const t = field(d, 'type')
  return typeof t === 'string' ? { o: d, t } : null
}

function f32_list(v: unknown): Float32Array[] | null {
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

function i16_list(v: unknown): Int16Array[] | null {
  if (!Array.isArray(v)) {
    return null
  }
  const out: Int16Array[] = []
  for (const x of v) {
    if (!(x instanceof Int16Array)) {
      return null
    }
    out.push(x)
  }
  return out
}

type chan_t = {
  ph_a: Float64Array
  ph_s: Float64Array
  mag_p: Float64Array
  mag: Float64Array
  ap: Float64Array
  dc: number
  nyq: number
}

function chan_new(half: number): chan_t {
  return {
    ph_a: new Float64Array(half + 1),
    ph_s: new Float64Array(half + 1),
    mag_p: new Float64Array(half + 1),
    mag: new Float64Array(half + 1),
    ap: new Float64Array(half + 1),
    dc: 0,
    nyq: 0,
  }
}

type pvx_t = {
  p: fftp_t
  n: number
  half: number
  kmax: number
  hop_s: number
  chans: chan_t[]
  win: Float64Array
  ob: Float64Array
  spr: Float64Array
  spi: Float64Array
  cep: Float64Array
  env: Float64Array
  corr: Float64Array
  aa: Float64Array
  band: Float64Array
  peaks: Int32Array
  owner: Int32Array
  last_base: number
  reset: boolean
  e_prev: number
  tr_hold: number
}

function band_lo(f: number): number {
  if (f <= XO_LO) {
    return 1
  }
  if (f >= XO_HI) {
    return 0
  }
  return 0.5 + 0.5 * Math.cos((Math.PI * (f - XO_LO)) / (XO_HI - XO_LO))
}

function pvx_new(n: number, sr: number, low: boolean): pvx_t {
  const p = fftp_new(n)
  const half = p.half
  const band = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    const b = band_lo((k * sr) / n)
    band[k] = low ? b : 1 - b
  }
  let kmax = half
  if (low) {
    kmax = Math.min(half, Math.ceil((XO_HI * n) / sr) + 4)
  }
  return {
    p,
    n,
    half,
    kmax,
    hop_s: low ? SYN_HOP * 2 : SYN_HOP,
    chans: [chan_new(half), chan_new(half)],
    win: new Float64Array(n),
    ob: new Float64Array(n),
    spr: new Float64Array(half + 1),
    spi: new Float64Array(half + 1),
    cep: new Float64Array(n),
    env: new Float64Array(half + 1),
    corr: new Float64Array(half + 1).fill(1),
    aa: new Float64Array(half + 1).fill(1),
    band,
    peaks: new Int32Array(half + 1),
    owner: new Int32Array(half + 1),
    last_base: 0,
    reset: true,
    e_prev: 0,
    tr_hold: 0,
  }
}

type pv_t = {
  sr: number
  len: number
  n_ch: number
  ch: Float32Array[]
  n_st: number
  st: Int16Array[]
  sc: Float32Array[]
  sg: Float32Array
  use_st: boolean

  playing: boolean
  draining: boolean
  ended_sent: boolean
  fade_in: number
  fade_out: number
  pause_after: boolean

  pitch: number
  tempo: number
  rate: number
  formant: boolean
  dir: number

  in_pos: number
  hop_acc: number
  last_hop: number
  last_base: number
  last_sp: number
  loop_s: number
  loop_e: number
  reset: boolean
  fast_prev: boolean
  jump: boolean
  g_n: number
  lo_tr: boolean

  ring: Float32Array[]
  s_pos: number
  r_pos: number
  z_pos: number

  hi: pvx_t
  lo: pvx_t
  b0: Float64Array
  b1: Float64Array
  h0: Float64Array
  h1: Float64Array
  rs_c: Float32Array

  w_kind: number
  w_x: number
  w_y: number
  w_t: number
  w_rate: number
  w_pitch: number
  w_tempo: number

  bt_on: boolean
  bt_period: number
  bt_ofs: number
  bt_vol: number
  bt_q: Float64Array
  bt_acc: Uint8Array
  bt_head: number
  bt_tail: number
  ck_n: number
  ck_t: number
  ck_inc: number
  ck_amp: number
  ck_dec: number

  report_cnt: number
}

function pv_new(sr: number): pv_t {
  const b0 = new Float64Array(N_LO)
  const b1 = new Float64Array(N_LO)
  return {
    sr,
    len: 0,
    n_ch: 0,
    ch: [],
    n_st: 0,
    st: [],
    sc: [],
    sg: new Float32Array(8).fill(1),
    use_st: false,
    playing: false,
    draining: false,
    ended_sent: false,
    fade_in: 0,
    fade_out: 0,
    pause_after: false,
    pitch: 1,
    tempo: 1,
    rate: 1,
    formant: false,
    dir: 1,
    in_pos: -START,
    hop_acc: 0,
    last_hop: SYN_HOP,
    last_base: -START,
    last_sp: 0,
    loop_s: -1,
    loop_e: -1,
    reset: true,
    fast_prev: true,
    jump: false,
    g_n: 0,
    lo_tr: false,
    ring: [new Float32Array(RING), new Float32Array(RING)],
    s_pos: 0,
    r_pos: START,
    z_pos: -N_LO,
    hi: pvx_new(N_HI, sr, false),
    lo: pvx_new(N_LO, sr, true),
    b0,
    b1,
    h0: b0.subarray(LO_PRE, LO_PRE + N_HI),
    h1: b1.subarray(LO_PRE, LO_PRE + N_HI),
    rs_c: new Float32Array(RS_TAPS),
    w_kind: 0,
    w_x: 0,
    w_y: 0,
    w_t: 0,
    w_rate: 1,
    w_pitch: 1,
    w_tempo: 1,
    bt_on: false,
    bt_period: 0,
    bt_ofs: 0,
    bt_vol: 0.5,
    bt_q: new Float64Array(16),
    bt_acc: new Uint8Array(16),
    bt_head: 0,
    bt_tail: 0,
    ck_n: 0,
    ck_t: 0,
    ck_inc: 0,
    ck_amp: 0,
    ck_dec: 0,
    report_cnt: 0,
  }
}

function pv_flush(st: pv_t): void {
  st.ring[0].fill(0)
  st.ring[1].fill(0)
  st.s_pos = 0
  st.r_pos = START
  st.z_pos = -N_LO
  st.hop_acc = 0
  st.draining = false
  st.ended_sent = false
  st.reset = true
  st.fade_in = FADE_N
  st.last_base = st.in_pos
  st.last_sp = 0
  st.last_hop = SYN_HOP
  st.g_n = 0
  st.lo_tr = false
  st.lo.reset = true
  st.hi.reset = true
  st.bt_head = 0
  st.bt_tail = 0
  st.ck_n = 0
}

function pv_audible(st: pv_t): number {
  const ratio = st.last_hop / SYN_HOP
  return st.last_base + st.dir * ((st.r_pos - st.last_sp) * ratio + (N_HI >> 1) * (1 - ratio))
}

function pv_clamp_pos(st: pv_t, p: number): number {
  const q = Math.round(p)
  return q < 0 ? 0 : q > st.len - 1 ? st.len - 1 : q
}

function pv_seek_to(st: pv_t, pos: number): void {
  st.in_pos = pv_clamp_pos(st, pos) - st.dir * START
  pv_flush(st)
}

function pv_choose_src(st: pv_t): void {
  if (st.n_st === 0) {
    st.use_st = false
    return
  }
  let unity = true
  for (let s = 0; s < st.n_st; s++) {
    if (st.sg[s] !== 1) {
      unity = false
      break
    }
  }
  st.use_st = !(unity && st.n_ch > 0)
}

function src_n_ch(st: pv_t): number {
  return st.use_st ? 2 : st.n_ch
}

function src_fill(st: pv_t, c: number, base: number, out: Float64Array): void {
  const len = st.len
  const dir = st.dir
  const n = out.length
  if (!st.use_st) {
    const x = st.ch[c < st.n_ch ? c : 0]
    if (dir > 0 && base >= 0 && base + n <= len) {
      for (let i = 0; i < n; i++) {
        out[i] = x[base + i]
      }
      return
    }
    for (let i = 0; i < n; i++) {
      const p = base + i * dir
      out[i] = p >= 0 && p < len ? x[p] : 0
    }
    return
  }
  out.fill(0)
  for (let s = 0; s < st.n_st; s++) {
    const g = st.sg[s]
    if (g === 0) {
      continue
    }
    const d = st.st[s * 2 + c]
    const sc = st.sc[s * 2 + c]
    for (let i = 0; i < n; i++) {
      const p = base + i * dir
      if (p >= 0 && p < len) {
        out[i] += d[p] * sc[p >> BFP_SHIFT] * g
      }
    }
  }
}

function src_fill_lr(st: pv_t, base: number): void {
  src_fill(st, 0, base, st.b0)
  if (src_n_ch(st) > 1) {
    src_fill(st, 1, base, st.b1)
  }
}

function pv_analyze(x: pvx_t, ch: chan_t, src: Float64Array): void {
  const p = x.p
  const w = x.win
  const n = x.n
  const hann = p.hann
  for (let i = 0; i < n; i++) {
    w[i] = src[i] * hann[i]
  }
  const spr = x.spr
  const spi = x.spi
  rfft_fwd(p, w, spr, spi)
  ch.dc = spr[0]
  ch.nyq = spr[x.half]
  const mag = ch.mag
  const ap = ch.ap
  const kmax = x.kmax
  for (let k = 1; k < kmax; k++) {
    const re = spr[k]
    const im = spi[k]
    mag[k] = Math.sqrt(re * re + im * im)
    ap[k] = Math.atan2(im, re)
  }
  mag[0] = Math.abs(ch.dc)
  mag[x.half] = Math.abs(ch.nyq)
}

function pv_phase(
  x: pvx_t,
  ch: chan_t,
  hop_in: number,
  reset_all: boolean,
  reset_k0: number,
): void {
  const mag = ch.mag
  const ap = ch.ap
  const ph_a = ch.ph_a
  const ph_s = ch.ph_s
  const kmax = x.kmax
  if (reset_all) {
    for (let k = 1; k < kmax; k++) {
      ph_s[k] = ap[k]
    }
  } else {
    const step = TWO_PI / x.n
    const scale = x.hop_s / hop_in
    let mx = 0
    for (let k = 1; k < kmax; k++) {
      const w = hop_in * k * step
      const dp = princ(ap[k] - ph_a[k] - w)
      ph_s[k] = princ(ph_s[k] + (w + dp) * scale)
      if (mag[k] > mx) {
        mx = mag[k]
      }
    }
    const floor = mx * 1e-6
    const peaks = x.peaks
    const owner = x.owner
    let np = 0
    for (let k = 2; k < kmax - 1; k++) {
      const m = mag[k]
      if (m > floor && m > mag[k - 1] && m >= mag[k + 1]) {
        peaks[np++] = k
      }
    }
    if (np > 0) {
      const first = peaks[0]
      const last = peaks[np - 1]
      for (let k = 1; k <= first; k++) {
        owner[k] = first
      }
      for (let i = 0; i + 1 < np; i++) {
        const a = peaks[i]
        const b = peaks[i + 1]
        let v = a + 1
        for (let j = a + 2; j < b; j++) {
          if (mag[j] < mag[v]) {
            v = j
          }
        }
        for (let j = a; j < v; j++) {
          owner[j] = a
        }
        for (let j = v; j <= b; j++) {
          owner[j] = b
        }
      }
      for (let k = last; k < kmax; k++) {
        owner[k] = last
      }
      for (let k = 1; k < kmax; k++) {
        const o = owner[k]
        if (o !== k) {
          ph_s[k] = princ(ph_s[o] + (ap[k] - ap[o]))
        }
      }
    }
    for (let k = reset_k0; k < kmax; k++) {
      ph_s[k] = ap[k]
    }
  }
  const mag_p = ch.mag_p
  for (let k = 1; k < kmax; k++) {
    ph_a[k] = ap[k]
    mag_p[k] = mag[k]
  }
}

function pv_stereo_lock(x: pvx_t): void {
  const l = x.chans[0]
  const r = x.chans[1]
  const kmax = x.kmax
  for (let k = 1; k < kmax; k++) {
    if (l.mag[k] >= r.mag[k]) {
      r.ph_s[k] = princ(l.ph_s[k] + (r.ap[k] - l.ap[k]))
    } else {
      l.ph_s[k] = princ(r.ph_s[k] + (l.ap[k] - r.ap[k]))
    }
  }
}

function pv_envelope(x: pvx_t, n_ch: number, pr: number, sr: number): void {
  const p = x.p
  const half = x.half
  const n = x.n
  const spr = x.spr
  const spi = x.spi
  const c0 = x.chans[0]
  const c1 = x.chans[1]
  const tgt_a = x.corr
  const env = x.env
  const cep = x.cep
  let mx = 0
  for (let k = 0; k <= half; k++) {
    let m = c0.mag[k]
    if (n_ch > 1) {
      m += c1.mag[k]
    }
    if (m > mx) {
      mx = m
    }
    tgt_a[k] = m
  }
  const floor = mx * 1e-5 + 1e-12
  for (let k = 0; k <= half; k++) {
    tgt_a[k] = Math.log(tgt_a[k] + floor)
  }
  let lq = Math.round(sr / 600)
  for (let it = 0; it < TE_ITER; it++) {
    for (let k = 0; k <= half; k++) {
      spr[k] = tgt_a[k]
      spi[k] = 0
    }
    rfft_inv(p, spr, spi, cep)
    if (it === 0) {
      const q0 = Math.round(sr / 1000)
      const q1 = Math.min(half - 1, Math.round(sr / 70))
      let pk = 0
      let pq = 0
      let sum = 0
      for (let q = q0; q <= q1; q++) {
        const v = cep[q]
        sum += Math.abs(v)
        if (v > pk) {
          pk = v
          pq = q
        }
      }
      if (pq > 0 && pk > (6 * sum) / (q1 - q0 + 1)) {
        lq = Math.round(pq * 0.5)
      }
      const lo = Math.round(sr / 1400)
      const hi = Math.round(sr / 280)
      lq = lq < lo ? lo : lq > hi ? hi : lq
    }
    const taper = lq >> 2
    for (let i = lq; i <= n - lq; i++) {
      cep[i] = 0
    }
    for (let i = lq - taper; i < lq; i++) {
      const w = 0.5 + 0.5 * Math.cos((Math.PI * (i - (lq - taper) + 1)) / (taper + 1))
      cep[i] *= w
      cep[n - i] *= w
    }
    rfft_fwd(p, cep, spr, spi)
    for (let k = 0; k <= half; k++) {
      env[k] = spr[k]
      if (spr[k] > tgt_a[k]) {
        tgt_a[k] = spr[k]
      }
    }
  }
  const corr = x.corr
  for (let k = 0; k <= half; k++) {
    const si = k * pr
    let tgt: number
    if (si >= half) {
      tgt = env[half]
    } else {
      const i0 = si | 0
      const fr = si - i0
      tgt = env[i0] * (1 - fr) + env[i0 + 1] * fr
    }
    let d = tgt - env[k]
    if (d > 2.76) {
      d = 2.76
    } else if (d < -2.76) {
      d = -2.76
    }
    corr[k] = Math.exp(d)
  }
}

function pv_corr_map(dst: pvx_t, src: pvx_t): void {
  const r = src.n / dst.n
  const sh = src.half
  for (let k = 0; k <= dst.kmax && k <= dst.half; k++) {
    const si = k * r
    const i0 = si | 0
    if (i0 >= sh) {
      dst.corr[k] = src.corr[sh]
      continue
    }
    const fr = si - i0
    dst.corr[k] = src.corr[i0] * (1 - fr) + src.corr[i0 + 1] * fr
  }
}

function pv_aa(x: pvx_t, ptot: number): void {
  const aa = x.aa
  const half = x.half
  if (ptot <= 1.0005) {
    aa.fill(1)
    return
  }
  const kc = Math.floor(half / ptot)
  let k0 = kc - Math.round((24 * half) / 1024)
  if (k0 < 1) {
    k0 = 1
  }
  for (let k = 0; k <= half; k++) {
    if (k < k0) {
      aa[k] = 1
    } else if (k < kc) {
      aa[k] = 0.5 * (1 + Math.cos((Math.PI * (k - k0)) / (kc - k0)))
    } else {
      aa[k] = 0
    }
  }
}

function pv_transient(x: pvx_t, n_ch: number, sr: number): boolean {
  const half = x.half
  const k0 = Math.round((1500 * x.n) / sr)
  const c0 = x.chans[0]
  const c1 = x.chans[1]
  const two = n_ch > 1
  let all = 0
  let mx = 0
  for (let k = 1; k < half; k++) {
    const m = two ? c0.mag[k] + c1.mag[k] : c0.mag[k]
    all += m * m
    if (m > mx) {
      mx = m
    }
  }
  const floor = mx * 1e-3
  let hf = 0
  let rise = 0
  for (let k = k0; k < half; k++) {
    const m = two ? c0.mag[k] + c1.mag[k] : c0.mag[k]
    if (m <= floor) {
      continue
    }
    const mp = two ? c0.mag_p[k] + c1.mag_p[k] : c0.mag_p[k]
    const e = m * m
    hf += e
    if (m > 2 * mp) {
      rise += e
    }
  }
  if (x.tr_hold > 0) {
    x.tr_hold--
  }
  const hit = x.tr_hold === 0 && hf > all * 0.01 && rise > hf * 0.6 && all > x.e_prev * 1.4
  x.e_prev = all
  if (hit) {
    x.tr_hold = 3
  }
  return hit
}

function pv_synth(st: pv_t, x: pvx_t, n_ch: number, at: number): void {
  const p = x.p
  const half = x.half
  const kmax = x.kmax
  const corr = x.corr
  const aa = x.aa
  const band = x.band
  const spr = x.spr
  const spi = x.spi
  const ob = x.ob
  const hs = p.hann_s
  const n = x.n
  for (let c = 0; c < n_ch; c++) {
    const ch = x.chans[c]
    const ring = st.ring[c]
    spr[0] = ch.dc * corr[0] * aa[0] * band[0]
    spi[0] = 0
    spr[half] = ch.nyq * corr[half] * aa[half] * band[half]
    spi[half] = 0
    for (let k = 1; k < half; k++) {
      if (k >= kmax) {
        spr[k] = 0
        spi[k] = 0
        continue
      }
      const g = ch.mag[k] * corr[k] * aa[k] * band[k]
      if (g === 0) {
        spr[k] = 0
        spi[k] = 0
        continue
      }
      const ph = ch.ph_s[k]
      spr[k] = g * Math.cos(ph)
      spi[k] = g * Math.sin(ph)
    }
    rfft_inv(p, spr, spi, ob)
    for (let i = 0; i < n; i++) {
      ring[(at + i) & RING_M] += ob[i] * hs[i]
    }
  }
}

function wander_step(st: pv_t, dt: number): void {
  st.w_rate = 1
  st.w_pitch = 1
  st.w_tempo = 1
  if (st.w_kind === 0) {
    return
  }
  st.w_t += dt
  const r1 = Math.random() * 2 - 1
  const r2 = Math.random() * 2 - 1
  switch (st.w_kind) {
    case 1: {
      st.w_x += (-st.w_x * 0.8 + r1 * 1.6) * dt
      st.w_rate = 0.95 + 0.04 * Math.sin(TWO_PI * 0.55 * st.w_t) + 0.008 * Math.tanh(st.w_x)
      break
    }
    case 2: {
      st.w_x += (-st.w_x * 0.5 + r1 * 1.2) * dt
      st.w_rate = 0.675 + 0.025 * Math.tanh(st.w_x)
      break
    }
    case 3: {
      const grow = st.w_t < 10 ? st.w_t / 10 : 1
      st.w_x += (-st.w_x * 0.35 + r1 * 1.4) * dt
      st.w_y += (-st.w_y * 0.35 + r2 * 1.4) * dt
      st.w_pitch = Math.pow(2, (grow * 1.6 * Math.tanh(st.w_x)) / 12)
      st.w_tempo = 1 + grow * 0.09 * Math.tanh(st.w_y)
      break
    }
  }
}

function beats_scan(st: pv_t, base: number, hop_a: number, sp: number): void {
  if (!st.bt_on || st.bt_period <= 0) {
    return
  }
  const t0 = st.dir > 0 ? base + OFS : base - OFS - hop_a
  const t1 = t0 + hop_a
  const per = st.bt_period
  let n = Math.ceil((t0 - st.bt_ofs) / per)
  for (;;) {
    const bt = st.bt_ofs + n * per
    if (bt >= t1) {
      break
    }
    const local = st.dir > 0 ? bt - t0 : t1 - bt
    const nx = (st.bt_tail + 1) & 15
    if (nx !== st.bt_head) {
      st.bt_q[st.bt_tail] = sp + OFS + (local * SYN_HOP) / hop_a
      st.bt_acc[st.bt_tail] = ((n % 4) + 4) % 4 === 0 ? 1 : 0
      st.bt_tail = nx
    }
    n++
  }
}

function pv_grain(st: pv_t, hop_a: number, ident: boolean, ptot: number): void {
  const n_ch = src_n_ch(st)
  const sp = st.s_pos
  const base = st.in_pos
  const pr = st.pitch * st.w_pitch
  const need_formant = st.formant && Math.abs(pr - 1) > 0.002
  const fast = ident && !need_formant && ptot <= 1.0005
  const hi = st.hi
  const lo = st.lo
  const base_lo = base - st.dir * LO_PRE

  src_fill_lr(st, base_lo)

  if (fast) {
    const r0 = st.ring[0]
    const r1 = st.ring[1]
    const ha = hi.p.hann_a
    const m = st.h0
    const s = st.h1
    for (let i = 0; i < N_HI; i++) {
      r0[(sp + i) & RING_M] += m[i] * ha[i]
    }
    if (n_ch > 1) {
      for (let i = 0; i < N_HI; i++) {
        r1[(sp + i) & RING_M] += s[i] * ha[i]
      }
    }
    st.fast_prev = true
    lo.reset = true
  } else {
    const hop_in = Math.abs(base - st.last_base)
    const reset_all =
      st.reset || st.fast_prev || st.jump || ident || hop_in < 1 || hop_in > N_LO * 4
    pv_analyze(hi, hi.chans[0], st.h0)
    if (n_ch > 1) {
      pv_analyze(hi, hi.chans[1], st.h1)
    }
    let tr = false
    if (!reset_all) {
      tr = pv_transient(hi, n_ch, st.sr)
    }
    const rk_hi = tr ? Math.max(2, Math.round((500 * N_HI) / st.sr)) : hi.half
    pv_phase(hi, hi.chans[0], hop_in, reset_all, rk_hi)
    if (n_ch > 1) {
      pv_phase(hi, hi.chans[1], hop_in, reset_all, rk_hi)
      if (!reset_all) {
        pv_stereo_lock(hi)
      }
    }
    if (reset_all) {
      lo.reset = true
    }
    if (tr) {
      st.lo_tr = true
    }
    if (need_formant) {
      pv_envelope(hi, n_ch, pr, st.sr)
    } else {
      hi.corr.fill(1)
    }
    pv_aa(hi, ptot)
    pv_synth(st, hi, n_ch, sp)

    if ((st.g_n & 1) === 0) {
      const hop_lo = Math.abs(base_lo - lo.last_base)
      const lo_reset = lo.reset || ident || hop_lo < 1 || hop_lo > N_LO * 4
      pv_analyze(lo, lo.chans[0], st.b0)
      if (n_ch > 1) {
        pv_analyze(lo, lo.chans[1], st.b1)
      }
      const rk_lo = st.lo_tr ? Math.max(2, Math.round((500 * N_LO) / st.sr)) : lo.kmax
      pv_phase(lo, lo.chans[0], hop_lo, lo_reset, rk_lo)
      if (n_ch > 1) {
        pv_phase(lo, lo.chans[1], hop_lo, lo_reset, rk_lo)
        if (!lo_reset) {
          pv_stereo_lock(lo)
        }
      }
      if (need_formant) {
        pv_corr_map(lo, hi)
      } else {
        lo.corr.fill(1)
      }
      pv_aa(lo, ptot)
      pv_synth(st, lo, n_ch, sp - LO_PRE)
      lo.last_base = base_lo
      lo.reset = false
      st.lo_tr = false
    }
    st.fast_prev = false
  }
  st.g_n++
  st.reset = false
  st.jump = false

  beats_scan(st, base, hop_a, sp)
  st.last_base = base
  st.last_sp = sp
  st.last_hop = hop_a
  st.in_pos += st.dir * hop_a
  st.s_pos += SYN_HOP
}

function pv_wrap(node: PvProcessor, st: pv_t): boolean {
  const looping = st.loop_e > 0 && st.loop_s >= 0 && st.loop_e - st.loop_s > 256
  const span = st.loop_e - st.loop_s
  if (st.dir > 0) {
    if (looping && st.in_pos + OFS >= st.loop_e) {
      const over = st.in_pos + OFS - st.loop_e
      st.in_pos = st.loop_s - OFS + (over < span ? over : 0)
      st.jump = true
      node.port.postMessage({ type: 'loop' })
      return true
    }
    if (st.in_pos >= st.len) {
      st.draining = true
      return false
    }
    return true
  }
  if (looping && st.in_pos - OFS <= st.loop_s) {
    const over = st.loop_s - (st.in_pos - OFS)
    st.in_pos = st.loop_e + OFS - (over < span ? over : 0)
    st.jump = true
    node.port.postMessage({ type: 'loop' })
    return true
  }
  if (st.in_pos < 0) {
    st.draining = true
    return false
  }
  return true
}

function pv_pump(node: PvProcessor, st: pv_t, need_out: number, ptot: number): void {
  const pr = st.pitch * st.w_pitch
  const tp = st.tempo * st.w_tempo
  const hop_exact = (SYN_HOP * tp) / pr
  const ident = Math.abs(hop_exact - SYN_HOP) < 1e-6
  const target = st.r_pos + need_out * ptot + RS_HALF + 2 + LO_PRE
  let produced = 0
  while (!st.draining && st.s_pos <= target && produced < MAX_GRAINS) {
    if (!pv_wrap(node, st)) {
      break
    }
    let hop_a = SYN_HOP
    if (!ident) {
      st.hop_acc += hop_exact
      hop_a = Math.floor(st.hop_acc)
      if (hop_a < 1) {
        hop_a = 1
      }
      st.hop_acc -= hop_a
    }
    pv_grain(st, hop_a, ident, ptot)
    produced++
  }
}

function pv_click_start(st: pv_t): void {
  const acc = st.bt_acc[st.bt_head] === 1
  st.bt_head = (st.bt_head + 1) & 15
  st.ck_n = Math.round(st.sr * 0.03)
  st.ck_t = 0
  st.ck_inc = (TWO_PI * (acc ? 2600 : 1800)) / st.sr
  st.ck_amp = st.bt_vol * (acc ? 0.9 : 0.6)
  st.ck_dec = Math.exp(-1 / (st.sr * 0.006))
}

function pv_read(
  st: pv_t,
  out_l: Float32Array,
  out_r: Float32Array,
  n: number,
  ptot: number,
): number {
  const rl = st.ring[0]
  const rr = st.ring[1]
  const stereo = src_n_ch(st) > 1
  const c = st.rs_c
  const limit = st.draining ? st.s_pos + N_LO - LO_PRE - SYN_HOP - RS_HALF : Infinity
  let rp = st.r_pos
  const exact = Math.abs(ptot - 1) < 1e-9 && rp === Math.floor(rp)
  let wrote = n
  for (let i = 0; i < n; i++) {
    if (rp >= limit) {
      wrote = i
      break
    }
    let m = 0
    let s = 0
    const r1 = Math.floor(rp)
    if (exact) {
      const idx = r1 & RING_M
      m = rl[idx]
      s = rr[idx]
    } else {
      const fp = (rp - r1) * RS_PH
      const p0 = fp | 0
      const a = fp - p0
      const o0 = p0 * RS_TAPS
      const o1 = o0 + RS_TAPS
      for (let j = 0; j < RS_TAPS; j++) {
        const h0 = RS_TAB[o0 + j]
        c[j] = h0 + a * (RS_TAB[o1 + j] - h0)
      }
      const b = r1 - RS_HALF + 1
      for (let j = 0; j < RS_TAPS; j++) {
        const idx = (b + j) & RING_M
        m += rl[idx] * c[j]
        s += rr[idx] * c[j]
      }
    }
    let l = m
    let r = stereo ? s : m
    if (st.bt_head !== st.bt_tail && rp >= st.bt_q[st.bt_head]) {
      pv_click_start(st)
    }
    if (st.ck_n > 0) {
      const v = st.ck_amp * Math.sin(st.ck_t * st.ck_inc)
      st.ck_amp *= st.ck_dec
      st.ck_t++
      st.ck_n--
      l += v
      r += v
    }
    if (st.fade_in > 0) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * (FADE_N - st.fade_in)) / FADE_N)
      l *= g
      r *= g
      st.fade_in--
    }
    rp += ptot
    if (st.fade_out > 0) {
      st.fade_out--
      const g = 0.5 - 0.5 * Math.cos((Math.PI * st.fade_out) / FADE_N)
      out_l[i] = l * g
      out_r[i] = r * g
      if (st.fade_out === 0) {
        wrote = i + 1
        break
      }
      continue
    }
    out_l[i] = l
    out_r[i] = r
  }
  st.r_pos = rp
  const zt = Math.floor(rp) - RS_HALF - 2
  let zp = st.z_pos
  if (zt - zp > RING) {
    zp = zt - RING
  }
  while (zp < zt) {
    const zi = zp & RING_M
    rl[zi] = 0
    rr[zi] = 0
    zp++
  }
  st.z_pos = zp
  return wrote
}

function pv_msg(node: PvProcessor, st: pv_t, d: unknown): void {
  const m = msg_type(d)
  if (!m) {
    return
  }
  const o = m.o
  switch (m.t) {
    case 'load': {
      const ch = f32_list(field(o, 'ch'))
      if (!ch || ch.length === 0 || ch.length > 2 || ch[0].length === 0) {
        break
      }
      if (ch.length === 2 && ch[1].length !== ch[0].length) {
        break
      }
      st.ch = ch
      st.n_ch = ch.length
      st.len = ch[0].length
      st.n_st = 0
      st.st = []
      st.sc = []
      st.sg.fill(1)
      st.use_st = false
      st.loop_s = -1
      st.loop_e = -1
      st.dir = f_num(o, 'dir', 1) < 0 ? -1 : 1
      st.in_pos = st.dir > 0 ? -START : st.len - 1 + START
      pv_flush(st)
      node.port.postMessage({ type: 'loaded', dur: st.len / st.sr })
      break
    }
    case 'release':
      st.ch = []
      st.n_ch = 0
      st.len = 0
      st.n_st = 0
      st.st = []
      st.sc = []
      st.use_st = false
      st.playing = false
      break
    case 'stems': {
      const data = i16_list(field(o, 'data'))
      const sc = f32_list(field(o, 'scale'))
      const n = f_num(o, 'n', 0) | 0
      if (!data || !sc || n <= 0 || n > 8 || data.length !== n * 2 || sc.length !== n * 2) {
        st.n_st = 0
        st.st = []
        st.sc = []
        pv_choose_src(st)
        break
      }
      const len = st.len > 0 ? st.len : data[0].length
      for (let i = 0; i < data.length; i++) {
        if (data[i].length < len || sc[i].length < (len >> BFP_SHIFT) + 1) {
          return
        }
      }
      st.len = len
      st.n_st = n
      st.st = data
      st.sc = sc
      st.sg.fill(1)
      pv_choose_src(st)
      break
    }
    case 'gains': {
      const g = field(o, 'g')
      if (g instanceof Float32Array) {
        for (let s = 0; s < st.sg.length; s++) {
          const v = s < g.length ? g[s] : 1
          st.sg[s] = Number.isFinite(v) && v >= 0 && v <= 4 ? v : 1
        }
        pv_choose_src(st)
      }
      break
    }
    case 'play':
      if (st.len > 0) {
        if (st.draining) {
          st.in_pos = st.dir > 0 ? -START : st.len - 1 + START
          pv_flush(st)
        }
        if (!st.playing || st.fade_out > 0) {
          st.fade_in = FADE_N
        }
        st.playing = true
        st.fade_out = 0
        st.pause_after = false
      }
      break
    case 'pause':
      if (st.playing && !st.pause_after) {
        st.fade_out = FADE_N
        st.pause_after = true
      }
      break
    case 'stop':
      st.playing = false
      st.fade_out = 0
      st.pause_after = false
      st.in_pos = st.dir > 0 ? -START : st.len - 1 + START
      pv_flush(st)
      break
    case 'seek': {
      const sec = f_num(o, 'sec', NaN)
      if (!Number.isFinite(sec) || st.len === 0) {
        break
      }
      pv_seek_to(st, sec * st.sr)
      break
    }
    case 'params': {
      const ndir = f_num(o, 'dir', st.dir) < 0 ? -1 : 1
      st.pitch = f_clamp(o, 'pitch', st.pitch, 0.25, 4)
      st.tempo = f_clamp(o, 'tempo', st.tempo, 0.05, 8)
      st.rate = f_clamp(o, 'rate', st.rate, 0.25, 4)
      st.formant = f_num(o, 'formant', st.formant ? 1 : 0) > 0.5
      if (ndir !== st.dir) {
        const at = st.len > 0 ? pv_audible(st) : 0
        st.dir = ndir
        if (st.len > 0) {
          pv_seek_to(st, at)
        }
      }
      break
    }
    case 'loop': {
      let ls = Math.floor(f_num(o, 's', NaN) * st.sr)
      let le = Math.floor(f_num(o, 'e', NaN) * st.sr)
      if (!Number.isFinite(ls) || !Number.isFinite(le)) {
        break
      }
      if (ls < 0) {
        ls = 0
      }
      if (le > st.len) {
        le = st.len
      }
      if (le - ls < 256) {
        st.loop_s = -1
        st.loop_e = -1
        break
      }
      st.loop_s = ls
      st.loop_e = le
      break
    }
    case 'noloop':
      st.loop_s = -1
      st.loop_e = -1
      break
    case 'wander':
      st.w_kind = f_clamp(o, 'kind', 0, 0, 3) | 0
      st.w_x = 0
      st.w_y = 0
      st.w_t = 0
      break
    case 'beats': {
      const bpm = f_num(o, 'bpm', 0)
      st.bt_on = f_num(o, 'on', 0) > 0.5 && bpm >= 30 && bpm <= 300
      st.bt_period = bpm > 0 ? (60 * st.sr) / bpm : 0
      st.bt_ofs = f_num(o, 'ofs', 0) * st.sr
      st.bt_vol = f_clamp(o, 'vol', 0.5, 0, 1)
      st.bt_head = 0
      st.bt_tail = 0
      break
    }
    case 'ping':
      node.port.postMessage({ type: 'pong', id: f_num(o, 'id', 0) })
      break
  }
}

class PvProcessor extends AudioWorkletProcessor {
  st: pv_t
  constructor() {
    super()
    this.st = pv_new(sampleRate)
    this.port.onmessage = (e: { data: unknown }): void => {
      pv_msg(this, this.st, e.data)
    }
  }
  process(_ins: Float32Array[][], outs: Float32Array[][]): boolean {
    pv_process(this, this.st, outs[0])
    return true
  }
}

function pv_process(node: PvProcessor, st: pv_t, out: Float32Array[]): void {
  const out_l = out[0]
  const out_r = out.length > 1 ? out[1] : out[0]
  const n = out_l.length
  if (!st.playing || st.len === 0) {
    for (let c = 0; c < out.length; c++) {
      out[c].fill(0)
    }
    return
  }
  wander_step(st, n / st.sr)
  let ptot = st.pitch * st.rate * st.w_pitch * st.w_rate
  if (ptot < 0.125) {
    ptot = 0.125
  } else if (ptot > 8) {
    ptot = 8
  }
  pv_pump(node, st, n, ptot)
  const wrote = pv_read(st, out_l, out_r, n, ptot)
  if (wrote < n) {
    for (let i = wrote; i < n; i++) {
      out_l[i] = 0
      out_r[i] = 0
    }
    if (st.pause_after && st.fade_out === 0) {
      st.pause_after = false
      st.playing = false
      pv_seek_to(st, pv_audible(st))
    } else if (st.draining && !st.ended_sent) {
      st.ended_sent = true
      st.playing = false
      node.port.postMessage({ type: 'ended' })
    }
  }
  st.report_cnt += n
  if (st.report_cnt >= REPORT_EVERY) {
    st.report_cnt = 0
    let p = pv_audible(st)
    if (p < 0) {
      p = 0
    } else if (p > st.len) {
      p = st.len
    }
    node.port.postMessage({ type: 'pos', t: p / st.sr, dur: st.len / st.sr })
  }
}

registerProcessor('pv-processor', PvProcessor)

type biq_t = {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
  z1: Float64Array
  z2: Float64Array
}

function biq_new(): biq_t {
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: new Float64Array(2), z2: new Float64Array(2) }
}

function biq_set(b: biq_t, kind: number, f: number, q: number, sr: number): void {
  const w = (TWO_PI * Math.min(f, sr * 0.49)) / sr
  const cw = Math.cos(w)
  const al = Math.sin(w) / (2 * q)
  const a0 = 1 + al
  if (kind === 0) {
    b.b0 = (1 - cw) / 2 / a0
    b.b1 = (1 - cw) / a0
    b.b2 = (1 - cw) / 2 / a0
  } else {
    b.b0 = (1 + cw) / 2 / a0
    b.b1 = -(1 + cw) / a0
    b.b2 = (1 + cw) / 2 / a0
  }
  b.a1 = (-2 * cw) / a0
  b.a2 = (1 - al) / a0
}

function biq_run(b: biq_t, c: number, x: number): number {
  const y = b.b0 * x + b.z1[c]
  b.z1[c] = b.b1 * x - b.a1 * y + b.z2[c]
  b.z2[c] = b.b2 * x - b.a2 * y
  return y
}

const MDL = 4096
const MDM = MDL - 1
const APS = 6
const DLY_MAX = 1 << 17
const DLY_M = DLY_MAX - 1

type fxp_t = {
  ch_mode: number
  vc: boolean
  pan: number
  width: number
  hp: number
  lp: number
  md_en: boolean
  md_mode: number
  md_rate: number
  md_depth: number
  md_fb: number
  md_mix: number
  ds_en: boolean
  ds_drive: number
  ds_tone: number
  ds_mix: number
  bc_en: boolean
  bc_bits: number
  bc_red: number
  dl_en: boolean
  dl_time: number
  dl_fb: number
  dl_mix: number
  dl_pp: boolean
  dl_damp: number
  cp_en: boolean
  cp_thr: number
  cp_rat: number
  cp_atk: number
  cp_rel: number
  cp_mk: number
  nz_en: boolean
  nz_amt: number
}

function fxp_default(): fxp_t {
  return {
    ch_mode: 0,
    vc: false,
    pan: 0,
    width: 1,
    hp: 0,
    lp: 0,
    md_en: false,
    md_mode: 0,
    md_rate: 0.5,
    md_depth: 0.5,
    md_fb: 0.3,
    md_mix: 0.5,
    ds_en: false,
    ds_drive: 12,
    ds_tone: 0.6,
    ds_mix: 1,
    bc_en: false,
    bc_bits: 16,
    bc_red: 1,
    dl_en: false,
    dl_time: 350,
    dl_fb: 0.35,
    dl_mix: 0.3,
    dl_pp: false,
    dl_damp: 0.3,
    cp_en: false,
    cp_thr: -10,
    cp_rat: 4,
    cp_atk: 10,
    cp_rel: 100,
    cp_mk: 0,
    nz_en: false,
    nz_amt: 0.5,
  }
}

function fxp_read(p: fxp_t, o: object): void {
  p.ch_mode = f_clamp(o, 'ch_mode', p.ch_mode, 0, 4) | 0
  p.vc = f_num(o, 'vc', p.vc ? 1 : 0) > 0.5
  p.pan = f_clamp(o, 'pan', p.pan, -1, 1)
  p.width = f_clamp(o, 'width', p.width, 0, 2)
  p.hp = f_clamp(o, 'hp', p.hp, 0, 20000)
  p.lp = f_clamp(o, 'lp', p.lp, 0, 20000)
  p.md_en = f_num(o, 'md_en', p.md_en ? 1 : 0) > 0.5
  p.md_mode = f_clamp(o, 'md_mode', p.md_mode, 0, 3) | 0
  p.md_rate = f_clamp(o, 'md_rate', p.md_rate, 0.01, 20)
  p.md_depth = f_clamp(o, 'md_depth', p.md_depth, 0, 1)
  p.md_fb = f_clamp(o, 'md_fb', p.md_fb, -0.95, 0.95)
  p.md_mix = f_clamp(o, 'md_mix', p.md_mix, 0, 1)
  p.ds_en = f_num(o, 'ds_en', p.ds_en ? 1 : 0) > 0.5
  p.ds_drive = f_clamp(o, 'ds_drive', p.ds_drive, 0, 48)
  p.ds_tone = f_clamp(o, 'ds_tone', p.ds_tone, 0, 1)
  p.ds_mix = f_clamp(o, 'ds_mix', p.ds_mix, 0, 1)
  p.bc_en = f_num(o, 'bc_en', p.bc_en ? 1 : 0) > 0.5
  p.bc_bits = f_clamp(o, 'bc_bits', p.bc_bits, 1, 16)
  p.bc_red = f_clamp(o, 'bc_red', p.bc_red, 1, 64)
  p.dl_en = f_num(o, 'dl_en', p.dl_en ? 1 : 0) > 0.5
  p.dl_time = f_clamp(o, 'dl_time', p.dl_time, 1, 2000)
  p.dl_fb = f_clamp(o, 'dl_fb', p.dl_fb, 0, 0.95)
  p.dl_mix = f_clamp(o, 'dl_mix', p.dl_mix, 0, 1)
  p.dl_pp = f_num(o, 'dl_pp', p.dl_pp ? 1 : 0) > 0.5
  p.dl_damp = f_clamp(o, 'dl_damp', p.dl_damp, 0, 1)
  p.cp_en = f_num(o, 'cp_en', p.cp_en ? 1 : 0) > 0.5
  p.cp_thr = f_clamp(o, 'cp_thr', p.cp_thr, -60, 0)
  p.cp_rat = f_clamp(o, 'cp_rat', p.cp_rat, 1, 20)
  p.cp_atk = f_clamp(o, 'cp_atk', p.cp_atk, 0.1, 200)
  p.cp_rel = f_clamp(o, 'cp_rel', p.cp_rel, 10, 2000)
  p.cp_mk = f_clamp(o, 'cp_mk', p.cp_mk, 0, 40)
  p.nz_en = f_num(o, 'nz_en', p.nz_en ? 1 : 0) > 0.5
  p.nz_amt = f_clamp(o, 'nz_amt', p.nz_amt, 0, 1)
}

type fx_t = {
  sr: number
  p: fxp_t
  hp_f: number
  lp_f: number
  hp1: biq_t
  hp2: biq_t
  lp1: biq_t
  lp2: biq_t
  vc1: biq_t
  vc2: biq_t
  md_dl: Float32Array[]
  md_dp: number
  md_lfo: number
  md_ax: Float64Array[]
  md_ay: Float64Array[]
  ds_u: Float64Array
  ds_f: Float64Array
  ds_lp: Float64Array
  bc_hold: Float64Array
  bc_cnt: number
  dl_buf: Float32Array[]
  dl_wp: number
  dl_t: number
  dl_lp: Float64Array
  cp_env: number
  nz_lp: Float64Array
  nz_ck: number
  nz_ckv: number
  fr: Float64Array
  ds_g: number
  ds_norm: number
  ds_a: number
}

function fx_new(sr: number): fx_t {
  const f: fx_t = {
    sr,
    p: fxp_default(),
    hp_f: -1,
    lp_f: -1,
    hp1: biq_new(),
    hp2: biq_new(),
    lp1: biq_new(),
    lp2: biq_new(),
    vc1: biq_new(),
    vc2: biq_new(),
    md_dl: [new Float32Array(MDL), new Float32Array(MDL)],
    md_dp: 0,
    md_lfo: 0,
    md_ax: [new Float64Array(APS), new Float64Array(APS)],
    md_ay: [new Float64Array(APS), new Float64Array(APS)],
    ds_u: new Float64Array(2),
    ds_f: new Float64Array(2),
    ds_lp: new Float64Array(2),
    bc_hold: new Float64Array(2),
    bc_cnt: 0,
    dl_buf: [new Float32Array(DLY_MAX), new Float32Array(DLY_MAX)],
    dl_wp: 0,
    dl_t: -1,
    dl_lp: new Float64Array(2),
    cp_env: 0,
    nz_lp: new Float64Array(2),
    nz_ck: 0,
    nz_ckv: 0,
    fr: new Float64Array(2),
    ds_g: 1,
    ds_norm: 1,
    ds_a: 1,
  }
  biq_set(f.vc1, 0, 140, Math.SQRT1_2, sr)
  biq_set(f.vc2, 0, 140, Math.SQRT1_2, sr)
  return f
}

function logcosh(u: number): number {
  const a = Math.abs(u)
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2
}

function fx_filters_update(f: fx_t): void {
  const p = f.p
  if (p.hp !== f.hp_f) {
    f.hp_f = p.hp
    if (p.hp > 0) {
      biq_set(f.hp1, 1, p.hp, 0.5412, f.sr)
      biq_set(f.hp2, 1, p.hp, 1.3066, f.sr)
    }
  }
  if (p.lp !== f.lp_f) {
    f.lp_f = p.lp
    if (p.lp > 0) {
      biq_set(f.lp1, 0, p.lp, 0.5412, f.sr)
      biq_set(f.lp2, 0, p.lp, 1.3066, f.sr)
    }
  }
}

function fx_frame(f: fx_t, l: number, r: number, out: Float64Array): void {
  const p = f.p
  switch (p.ch_mode) {
    case 1: {
      const m = (l + r) * 0.5
      l = m
      r = m
      break
    }
    case 2:
      r = l
      break
    case 3:
      l = r
      break
    case 4: {
      const t = l
      l = r
      r = t
      break
    }
  }
  if (p.vc) {
    const m = (l + r) * 0.5
    const s = (l - r) * 0.5
    let lo = biq_run(f.vc1, 0, m)
    lo = biq_run(f.vc2, 0, lo)
    l = lo + s
    r = lo - s
  }
  if (p.width !== 1) {
    const m = (l + r) * 0.5
    const s = (l - r) * 0.5 * p.width
    l = m + s
    r = m - s
  }
  if (p.pan !== 0) {
    if (p.pan > 0) {
      l *= 1 - p.pan
    } else {
      r *= 1 + p.pan
    }
  }
  out[0] = l
  out[1] = r
}

function fx_md(f: fx_t, x: number, ch: number, lv: number): number {
  const p = f.p
  let wet: number
  if (p.md_mode < 2) {
    const base = p.md_mode === 0 ? 0.001 * f.sr : 0.02 * f.sr
    const mod = p.md_mode === 0 ? p.md_depth * 0.005 * f.sr : p.md_depth * 0.015 * f.sr
    let dly = base + lv * mod
    if (dly < 1) {
      dly = 1
    }
    let rp = f.md_dp - dly
    while (rp < 0) {
      rp += MDL
    }
    const i1 = rp | 0
    const fr = rp - i1
    const d = f.md_dl[ch]
    const y0 = d[(i1 - 1) & MDM]
    const y1 = d[i1 & MDM]
    const y2 = d[(i1 + 1) & MDM]
    const y3 = d[(i1 + 2) & MDM]
    wet =
      (((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * fr + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * fr +
        0.5 * (y2 - y0)) *
        fr +
      y1
    d[f.md_dp] = x + wet * p.md_fb
  } else if (p.md_mode === 2) {
    const fq = 200 + (0.5 + 0.5 * lv) * 3800
    const tn = Math.tan((Math.PI * fq) / f.sr)
    const a = (tn - 1) / (tn + 1)
    wet = x
    const ax = f.md_ax[ch]
    const ay = f.md_ay[ch]
    for (let s = 0; s < APS; s++) {
      const yn = -a * wet + ax[s] + a * ay[s]
      ax[s] = wet
      ay[s] = yn
      wet = yn
    }
  } else {
    const tri = 1 - 2 * Math.abs(f.md_lfo - 0.5)
    wet = x * (1 - p.md_depth * tri)
  }
  return x * (1 - p.md_mix) + wet * p.md_mix
}

function fx_ds(f: fx_t, x: number, ch: number): number {
  const p = f.p
  const u = x * f.ds_g
  const du = u - f.ds_u[ch]
  const fu = logcosh(u)
  let y: number
  if (Math.abs(du) > 1e-6) {
    y = (fu - f.ds_f[ch]) / du
  } else {
    y = Math.tanh(0.5 * (u + f.ds_u[ch]))
  }
  f.ds_u[ch] = u
  f.ds_f[ch] = fu
  y *= f.ds_norm
  f.ds_lp[ch] += f.ds_a * (y - f.ds_lp[ch])
  return x * (1 - p.ds_mix) + f.ds_lp[ch] * p.ds_mix
}

function fx_process(f: fx_t, inp: Float32Array[], out: Float32Array[]): void {
  const p = f.p
  const n = out[0].length
  const il = inp[0]
  const ir = inp.length > 1 ? inp[1] : inp[0]
  const ol = out[0]
  const or = out.length > 1 ? out[1] : out[0]
  const any =
    p.ch_mode !== 0 ||
    p.vc ||
    p.width !== 1 ||
    p.pan !== 0 ||
    p.hp > 0 ||
    p.lp > 0 ||
    p.md_en ||
    p.ds_en ||
    p.bc_en ||
    p.dl_en ||
    p.cp_en ||
    p.nz_en
  if (!any) {
    ol.set(il)
    if (or !== ol) {
      or.set(ir)
    }
    f.dl_t = -1
    return
  }
  fx_filters_update(f)
  const fr = f.fr
  f.ds_g = Math.pow(10, p.ds_drive / 20)
  f.ds_norm = 1 / Math.tanh(f.ds_g > 1 ? f.ds_g : 1)
  const ds_fc = 600 + p.ds_tone * p.ds_tone * 14000
  f.ds_a = 1 - Math.exp((-TWO_PI * ds_fc) / f.sr)
  const l_inc = p.md_rate / f.sr
  const bc_step = Math.pow(0.5, p.bc_bits - 1)
  const bc_red = Math.max(1, Math.floor(p.bc_red))
  const cp_ac = 1 - Math.exp(-1 / (p.cp_atk * 0.001 * f.sr))
  const cp_rc = 1 - Math.exp(-1 / (p.cp_rel * 0.001 * f.sr))
  const knee = 6
  const dl_target = (p.dl_time * 0.001 * f.sr) | 0
  if (f.dl_t < 0) {
    f.dl_t = dl_target
  }
  const damp_a = 1 - p.dl_damp * 0.85
  for (let i = 0; i < n; i++) {
    fx_frame(f, il[i], ir[i], fr)
    let l = fr[0]
    let r = fr[1]
    if (p.hp > 0) {
      l = biq_run(f.hp2, 0, biq_run(f.hp1, 0, l))
      r = biq_run(f.hp2, 1, biq_run(f.hp1, 1, r))
    }
    if (p.lp > 0) {
      l = biq_run(f.lp2, 0, biq_run(f.lp1, 0, l))
      r = biq_run(f.lp2, 1, biq_run(f.lp1, 1, r))
    }
    if (p.md_en) {
      const lv = Math.sin(f.md_lfo * TWO_PI)
      f.md_lfo += l_inc
      if (f.md_lfo >= 1) {
        f.md_lfo -= 1
      }
      l = fx_md(f, l, 0, lv)
      r = fx_md(f, r, 1, lv)
      f.md_dp = (f.md_dp + 1) & MDM
    }
    if (p.ds_en) {
      l = fx_ds(f, l, 0)
      r = fx_ds(f, r, 1)
    }
    if (p.bc_en) {
      f.bc_cnt++
      if (f.bc_cnt >= bc_red) {
        f.bc_cnt = 0
        f.bc_hold[0] = Math.round(l / bc_step) * bc_step
        f.bc_hold[1] = Math.round(r / bc_step) * bc_step
      }
      l = f.bc_hold[0]
      r = f.bc_hold[1]
    }
    if (p.dl_en) {
      if (f.dl_t !== dl_target) {
        f.dl_t += f.dl_t < dl_target ? 1 : -1
      }
      const rp = (f.dl_wp - f.dl_t) & DLY_M
      const bl = f.dl_buf[0]
      const br = f.dl_buf[1]
      const yl = bl[rp]
      const yr = br[rp]
      f.dl_lp[0] += damp_a * (yl - f.dl_lp[0])
      f.dl_lp[1] += damp_a * (yr - f.dl_lp[1])
      if (p.dl_pp) {
        bl[f.dl_wp] = (l + r) * 0.5 + f.dl_lp[1] * p.dl_fb
        br[f.dl_wp] = f.dl_lp[0] * p.dl_fb
      } else {
        bl[f.dl_wp] = l + f.dl_lp[0] * p.dl_fb
        br[f.dl_wp] = r + f.dl_lp[1] * p.dl_fb
      }
      f.dl_wp = (f.dl_wp + 1) & DLY_M
      l += yl * p.dl_mix
      r += yr * p.dl_mix
    }
    if (p.cp_en) {
      let pk = Math.abs(l)
      const pr = Math.abs(r)
      if (pr > pk) {
        pk = pr
      }
      const lvl = 20 * Math.log10(pk + 1e-10)
      const over = lvl - p.cp_thr
      let gr = 0
      if (over > knee / 2) {
        gr = over * (1 - 1 / p.cp_rat)
      } else if (over > -knee / 2) {
        const t = over + knee / 2
        gr = ((1 - 1 / p.cp_rat) * t * t) / (2 * knee)
      }
      f.cp_env += (gr - f.cp_env) * (gr > f.cp_env ? cp_ac : cp_rc)
      const g = Math.pow(10, (-f.cp_env + p.cp_mk) / 20)
      l *= g
      r *= g
    }
    if (p.nz_en) {
      const hiss = (Math.random() * 2 - 1) * 0.004 * p.nz_amt
      f.nz_lp[0] += 0.25 * (hiss - f.nz_lp[0])
      f.nz_lp[1] += 0.25 * ((Math.random() * 2 - 1) * 0.004 * p.nz_amt - f.nz_lp[1])
      if (f.nz_ck <= 0 && Math.random() < (14 * p.nz_amt) / f.sr) {
        f.nz_ck = 8 + ((Math.random() * 40) | 0)
        f.nz_ckv = (Math.random() * 2 - 1) * 0.25 * p.nz_amt
      }
      let ck = 0
      if (f.nz_ck > 0) {
        ck = f.nz_ckv * (f.nz_ck / 48)
        f.nz_ckv *= -0.8
        f.nz_ck--
      }
      l += f.nz_lp[0] + ck
      r += f.nz_lp[1] + ck
    }
    ol[i] = l
    or[i] = r
  }
}

class FxProcessor extends AudioWorkletProcessor {
  f: fx_t
  constructor() {
    super()
    this.f = fx_new(sampleRate)
    this.port.onmessage = (e: { data: unknown }): void => {
      const m = msg_type(e.data)
      if (!m) {
        return
      }
      if (m.t === 'set') {
        fxp_read(this.f.p, m.o)
      } else if (m.t === 'ping') {
        this.port.postMessage({ type: 'pong', id: f_num(m.o, 'id', 0) })
      }
    }
  }
  process(ins: Float32Array[][], outs: Float32Array[][]): boolean {
    const inp = ins[0]
    const out = outs[0]
    if (!inp || inp.length === 0) {
      for (let c = 0; c < out.length; c++) {
        out[c].fill(0)
      }
      return true
    }
    fx_process(this.f, inp, out)
    return true
  }
}

registerProcessor('fx-processor', FxProcessor)

const LIM_LA = 64

type out_t = {
  sr: number
  gain: number
  gain_t: number
  fade: number
  fade_from: number
  fade_to: number
  fade_n: number
  fade_len: number
  fade_id: number
  lim: boolean
  ceil: number
  dl: Float32Array[]
  req: Float32Array
  wp: number
  env: number
  rel: number
  ga: number
}

function out_new(sr: number): out_t {
  return {
    sr,
    gain: 0.8,
    gain_t: 0.8,
    fade: 1,
    fade_from: 1,
    fade_to: 1,
    fade_n: 0,
    fade_len: 0,
    fade_id: 0,
    lim: true,
    ceil: 0.966,
    dl: [new Float32Array(LIM_LA), new Float32Array(LIM_LA)],
    req: new Float32Array(LIM_LA).fill(1),
    wp: 0,
    env: 1,
    rel: 1 - Math.exp(-1 / (0.08 * sr)),
    ga: 1 - Math.exp(-1 / (0.012 * sr)),
  }
}

class OutProcessor extends AudioWorkletProcessor {
  o: out_t
  constructor() {
    super()
    this.o = out_new(sampleRate)
    this.port.onmessage = (e: { data: unknown }): void => {
      const m = msg_type(e.data)
      if (!m) {
        return
      }
      const o = this.o
      switch (m.t) {
        case 'gain':
          o.gain_t = f_clamp(m.o, 'g', o.gain_t, 0, 16)
          if (f_num(m.o, 'now', 0) > 0.5) {
            o.gain = o.gain_t
          }
          break
        case 'lim':
          o.lim = f_num(m.o, 'on', 1) > 0.5
          break
        case 'fade': {
          const to = f_clamp(m.o, 'to', 1, 0, 1)
          const sec = f_clamp(m.o, 'sec', 0, 0, 60)
          o.fade_id = f_num(m.o, 'id', 0)
          o.fade_from = o.fade
          o.fade_to = to
          o.fade_len = Math.max(1, Math.round(sec * o.sr))
          o.fade_n = o.fade_len
          break
        }
        case 'ping':
          this.port.postMessage({ type: 'pong', id: f_num(m.o, 'id', 0) })
          break
      }
    }
  }
  process(ins: Float32Array[][], outs: Float32Array[][]): boolean {
    const o = this.o
    const inp = ins[0]
    const out = outs[0]
    const ol = out[0]
    const or = out.length > 1 ? out[1] : out[0]
    const n = ol.length
    const has = inp && inp.length > 0
    const il = has ? inp[0] : null
    const ir = has ? (inp.length > 1 ? inp[1] : inp[0]) : null
    const ga = o.ga
    for (let i = 0; i < n; i++) {
      o.gain += (o.gain_t - o.gain) * ga
      if (o.fade_n > 0) {
        o.fade_n--
        const t = 1 - o.fade_n / o.fade_len
        const s = 0.5 - 0.5 * Math.cos(Math.PI * t)
        o.fade = o.fade_from + (o.fade_to - o.fade_from) * s
        if (o.fade_n === 0) {
          o.fade = o.fade_to
          this.port.postMessage({ type: 'faded', id: o.fade_id })
        }
      }
      const g = o.gain * o.fade
      const xl = il ? il[i] * g : 0
      const xr = ir ? ir[i] * g : 0
      if (!o.lim) {
        ol[i] = xl
        or[i] = xr
        continue
      }
      let pk = Math.abs(xl)
      const pr = Math.abs(xr)
      if (pr > pk) {
        pk = pr
      }
      const need = pk > o.ceil ? o.ceil / pk : 1
      const w = o.wp
      const yl = o.dl[0][w]
      const yr = o.dl[1][w]
      o.dl[0][w] = xl
      o.dl[1][w] = xr
      o.req[w] = need
      o.wp = (w + 1) & (LIM_LA - 1)
      let mn = 1
      for (let k = 0; k < LIM_LA; k++) {
        if (o.req[k] < mn) {
          mn = o.req[k]
        }
      }
      if (mn < o.env) {
        o.env += (mn - o.env) * 0.25
        if (o.env < mn) {
          o.env = mn
        }
      } else {
        o.env += (mn - o.env) * o.rel
      }
      let gl = o.env
      const ol_pk = Math.max(Math.abs(yl), Math.abs(yr))
      if (ol_pk * gl > o.ceil) {
        gl = o.ceil / ol_pk
      }
      ol[i] = yl * gl
      or[i] = yr * gl
    }
    return true
  }
}

registerProcessor('out-processor', OutProcessor)
