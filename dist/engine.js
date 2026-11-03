import { clamp, EQ_BANDS, is_rec, field, num_or } from './types.js'
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const WORKLET_URL = new URL('./worklet/dsp.js', import.meta.url).href
const ANA_URL = new URL('./worker/ana.js', import.meta.url).href
export const MD_MODES = { fl: 0, ch: 1, ph: 2, tr: 3 }
export function fx_params_default() {
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
function fx_same(a, b) {
  for (const k of Object.keys(a)) {
    if (field(a, k) !== field(b, k)) {
      return false
    }
  }
  return true
}
function fx_msg(p) {
  const m = {}
  for (const k of Object.keys(p)) {
    const v = field(p, k)
    m[k] = typeof v === 'boolean' ? (v ? 1 : 0) : num_or(v, 0)
  }
  return m
}
async function worklet_add(ctx) {
  try {
    await ctx.audioWorklet.addModule(WORKLET_URL)
    return
  } catch {}
  const res = await fetch(WORKLET_URL)
  if (!res.ok) {
    throw new Error('音声処理モジュールを読み込めません (' + String(res.status) + ')')
  }
  const code = await res.text()
  const blob_url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    await ctx.audioWorklet.addModule(blob_url)
  } finally {
    URL.revokeObjectURL(blob_url)
  }
}
function make_eq(ctx, gains) {
  return EQ_BANDS.map((freq, i) => {
    const f = ctx.createBiquadFilter()
    if (i === 0) {
      f.type = 'lowshelf'
    } else if (i === EQ_BANDS.length - 1) {
      f.type = 'highshelf'
    } else {
      f.type = 'peaking'
      f.Q.value = 1.4
    }
    f.frequency.value = freq
    f.gain.value = gains ? clamp(gains[i] ?? 0, -12, 12) : 0
    return f
  })
}
const IR_SPECS = {
  hall: { t60: 2.6, pre: 0.02, damp0: 14000, damp1: 3500, er: 0.4 },
  room: { t60: 0.7, pre: 0.006, damp0: 12000, damp1: 4000, er: 0.6 },
  plate: { t60: 1.6, pre: 0.0, damp0: 18000, damp1: 8000, er: 0.0 },
  church: { t60: 5.0, pre: 0.035, damp0: 9000, damp1: 2200, er: 0.5 },
  cave: { t60: 3.6, pre: 0.05, damp0: 6000, damp1: 1500, er: 0.9 },
}
export function ir_duration(type) {
  const sp = IR_SPECS[type] ?? IR_SPECS['hall']
  return sp ? sp.t60 + sp.pre + 0.1 : 3
}
function make_reverb_ir(ctx, type) {
  const sp = IR_SPECS[type] ?? { t60: 2.6, pre: 0.02, damp0: 14000, damp1: 3500, er: 0.4 }
  const sr = ctx.sampleRate
  const len = Math.max(1, Math.floor(sr * (sp.t60 + sp.pre)))
  const ir = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr })
  const pre = Math.floor(sp.pre * sr)
  const k_decay = Math.log(1000) / (sp.t60 * sr)
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    let lp = 0
    let seed = c === 0 ? 0x1234567 : 0x7654321
    for (let i = pre; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const nz = (seed / 4294967296) * 2 - 1
      const t = (i - pre) / (len - pre)
      const fc = sp.damp0 * Math.pow(sp.damp1 / sp.damp0, t)
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr)
      lp += a * (nz - lp)
      d[i] = lp * Math.exp(-k_decay * (i - pre))
    }
    if (sp.er > 0) {
      for (let r = 0; r < 8; r++) {
        const at = pre + Math.floor(sr * (0.004 + 0.009 * r + (c === 0 ? 0.0013 : 0.0021) * r))
        if (at < len) {
          d[at] = (d[at] ?? 0) + sp.er * Math.pow(0.78, r) * (r % 2 === 0 ? 1 : -0.8)
        }
      }
    }
    let e = 0
    for (let i = 0; i < len; i++) {
      e += d[i] * d[i]
    }
    const g = e > 0 ? 1 / Math.sqrt(e) : 1
    for (let i = 0; i < len; i++) {
      d[i] *= g * 0.9
    }
  }
  return ir
}
function chain_build(ctx) {
  const w_src = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }
  const w_fx = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }
  const c = {
    pv: new AudioWorkletNode(ctx, 'pv-processor', w_src),
    fx_in: ctx.createGain(),
    eqs: make_eq(ctx, null),
    fx: new AudioWorkletNode(ctx, 'fx-processor', w_fx),
    conv: ctx.createConvolver(),
    wet: ctx.createGain(),
    dry: ctx.createGain(),
    out: new AudioWorkletNode(ctx, 'out-processor', w_fx),
    conv_on: false,
    conv_timer: 0,
    ir_type: '',
  }
  c.wet.gain.value = 0
  c.dry.gain.value = 1
  c.pv.connect(c.fx_in)
  let node = c.fx_in
  for (const eq of c.eqs) {
    node.connect(eq)
    node = eq
  }
  node.connect(c.fx)
  c.fx.connect(c.dry)
  c.conv.connect(c.wet)
  c.dry.connect(c.out)
  c.wet.connect(c.out)
  return c
}
function chain_reverb_type(c, ctx, type) {
  if (c.ir_type === type) {
    return
  }
  c.ir_type = type
  c.conv.buffer = make_reverb_ir(ctx, type)
}
function chain_reverb(c, ctx, w, smooth) {
  const ww = clamp(w, 0, 1)
  const t = ctx.currentTime
  if (ww > 0 && !c.conv_on) {
    c.fx.connect(c.conv)
    c.conv_on = true
  }
  if (c.conv_timer !== 0) {
    clearTimeout(c.conv_timer)
    c.conv_timer = 0
  }
  if (smooth) {
    c.wet.gain.setTargetAtTime(ww, t, 0.03)
    c.dry.gain.setTargetAtTime(1 - ww * 0.5, t, 0.03)
  } else {
    c.wet.gain.value = ww
    c.dry.gain.value = 1 - ww * 0.5
  }
  if (ww === 0 && c.conv_on && smooth) {
    const ms = (ir_duration(c.ir_type) + 0.3) * 1000
    c.conv_timer = window.setTimeout(() => {
      c.conv_timer = 0
      if (c.wet.gain.value < 1e-4 && c.conv_on) {
        c.fx.disconnect(c.conv)
        c.conv_on = false
      }
    }, ms)
  }
}
function chain_apply(c, ctx, m, last, smooth) {
  const t = ctx.currentTime
  if (
    !last ||
    last.pv.pitch !== m.pv.pitch ||
    last.pv.tempo !== m.pv.tempo ||
    last.pv.rate !== m.pv.rate ||
    last.pv.formant !== m.pv.formant ||
    last.pv.dir !== m.pv.dir
  ) {
    c.pv.port.postMessage({
      type: 'params',
      pitch: m.pv.pitch,
      tempo: m.pv.tempo,
      rate: m.pv.rate,
      formant: m.pv.formant ? 1 : 0,
      dir: m.pv.dir,
    })
  }
  if (!last || last.wander !== m.wander) {
    c.pv.port.postMessage({ type: 'wander', kind: m.wander })
  }
  if (!last || !fx_same(last.fx, m.fx)) {
    c.fx.port.postMessage({ type: 'set', ...fx_msg(m.fx) })
  }
  for (let i = 0; i < c.eqs.length; i++) {
    const g = clamp(m.eq[i] ?? 0, -12, 12)
    if (!last || (last.eq[i] ?? 0) !== g) {
      const f = c.eqs[i]
      if (!f) {
        continue
      }
      if (smooth) {
        f.gain.setTargetAtTime(g, t, 0.02)
      } else {
        f.gain.value = g
      }
    }
  }
  if (!last || last.reverb_type !== m.reverb_type) {
    chain_reverb_type(c, ctx, m.reverb_type)
  }
  if (!last || last.reverb !== m.reverb) {
    chain_reverb(c, ctx, m.reverb, smooth)
  }
  if (!last || last.gain !== m.gain) {
    c.out.port.postMessage({ type: 'gain', g: m.gain, now: smooth ? 0 : 1 })
  }
  if (!last || last.limiter !== m.limiter) {
    c.out.port.postMessage({ type: 'lim', on: m.limiter ? 1 : 0 })
  }
}
function mix_copy(m) {
  return {
    pv: { ...m.pv },
    fx: { ...m.fx },
    eq: [...m.eq],
    reverb: m.reverb,
    reverb_type: m.reverb_type,
    gain: m.gain,
    limiter: m.limiter,
    wander: m.wander,
  }
}
function make_silent_wav_uri(sec) {
  const sr = 8000
  const n = sr * sec
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const put = (s, off) => {
    for (let i = 0; i < s.length; i++) {
      v.setUint8(off + i, s.charCodeAt(i))
    }
  }
  put('RIFF', 0)
  v.setUint32(4, 36 + n * 2, true)
  put('WAVE', 8)
  put('fmt ', 12)
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sr, true)
  v.setUint32(28, sr * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  put('data', 36)
  v.setUint32(40, n * 2, true)
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i] ?? 0)
  }
  return 'data:audio/wav;base64,' + btoa(s)
}
function emit(e, ev) {
  for (const h of e.listeners) {
    h(ev)
  }
}
function msg_type(d) {
  if (!is_rec(d)) {
    return ''
  }
  const t = field(d, 'type')
  return typeof t === 'string' ? t : ''
}
function on_pv_msg(e, d) {
  if (!is_rec(d)) {
    return
  }
  switch (msg_type(d)) {
    case 'pos':
      emit(e, {
        type: 'position',
        current: num_or(field(d, 't'), 0),
        total: num_or(field(d, 'dur'), 0),
      })
      break
    case 'ended':
      emit(e, { type: 'ended' })
      break
    case 'loop':
      emit(e, { type: 'loop' })
      break
    case 'loaded':
      e.duration = num_or(field(d, 'dur'), 0)
      emit(e, { type: 'loaded', duration: e.duration })
      break
  }
}
function new_audio_context() {
  try {
    return new AudioContext({ sampleRate: 44100, latencyHint: 'playback' })
  } catch {
    return new AudioContext({ latencyHint: 'playback' })
  }
}
export async function eng_init() {
  const ctx = new_audio_context()
  await worklet_add(ctx)
  const c = chain_build(ctx)
  const e = {
    ctx,
    c,
    analyser: ctx.createAnalyser(),
    mic_gain: ctx.createGain(),
    mic_src: null,
    mic_stream: null,
    silent_el: null,
    pv_playing: false,
    ana: null,
    ana_job: 0,
    listeners: [],
    duration: 0,
    sr: ctx.sampleRate,
    last: null,
    pd_buf: new Float32Array(new ArrayBuffer(2048 * 4)),
    pd_acf: new Float32Array(1024),
  }
  e.analyser.fftSize = 2048
  e.analyser.smoothingTimeConstant = 0.8
  e.mic_gain.connect(c.fx_in)
  c.out.connect(e.analyser)
  e.analyser.connect(ctx.destination)
  c.pv.port.onmessage = (ev) => on_pv_msg(e, ev.data)
  const sil = document.createElement('audio')
  sil.src = make_silent_wav_uri(2)
  sil.loop = true
  sil.volume = 0.001
  sil.setAttribute('playsinline', '')
  sil.setAttribute('webkit-playsinline', '')
  document.body.appendChild(sil)
  e.silent_el = sil
  eng_unlock_wire(e)
  const nav = navigator
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback'
    } catch {}
  }
  return e
}
export function eng_resume(e) {
  if (e.ctx.state !== 'running' && e.ctx.state !== 'closed') {
    e.ctx.resume().catch(() => {})
  }
}
function eng_unlock_wire(e) {
  let el_ok = false
  const on = () => {
    eng_resume(e)
    const sil = e.silent_el
    if (!el_ok && sil) {
      el_ok = true
      sil
        .play()
        .then(() => {
          if (e.pv_playing === false) {
            sil.pause()
          }
        })
        .catch(() => {
          el_ok = false
        })
    }
  }
  for (const t of ['pointerdown', 'touchend', 'keydown']) {
    window.addEventListener(t, on, { capture: true, passive: true })
  }
}
export async function eng_decode(e, buf) {
  return e.ctx.decodeAudioData(buf)
}
export async function eng_decode_at(buf, sr) {
  const off = new OfflineAudioContext(2, 1, sr)
  return off.decodeAudioData(buf)
}
function shared_ok() {
  return typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true
}
function chan_alloc(len, shared) {
  if (shared) {
    return new Float32Array(new SharedArrayBuffer(len * 4))
  }
  return new Float32Array(len)
}
export function eng_load(e, ab, dir, analyze) {
  const n_ch = ab.numberOfChannels > 1 ? 2 : 1
  const len = ab.length
  const shared = shared_ok()
  const chs = []
  for (let c = 0; c < n_ch; c++) {
    const a = chan_alloc(len, shared)
    a.set(ab.getChannelData(c))
    chs.push(a)
  }
  e.duration = ab.duration
  e.sr = ab.sampleRate
  const ana_chs = shared ? chs : chs.map((x) => x.slice())
  const tr = []
  if (!shared) {
    for (const x of chs) {
      if (x.buffer instanceof ArrayBuffer) {
        tr.push(x.buffer)
      }
    }
  }
  e.c.pv.port.postMessage({ type: 'load', ch: chs, dir }, tr)
  return eng_analyze(e, ana_chs, ab.sampleRate, analyze, shared)
}
function eng_analyze(e, chs, sr, want, shared) {
  const job = ++e.ana_job
  if (e.ana) {
    e.ana.terminate()
    e.ana = null
  }
  let w
  try {
    w = new Worker(ANA_URL, { type: 'module' })
  } catch {
    return job
  }
  e.ana = w
  w.onmessage = (ev) => {
    const d = ev.data
    if (!is_rec(d) || num_or(field(d, 'job'), -1) !== e.ana_job) {
      return
    }
    const t = msg_type(d)
    if (t === 'peaks') {
      const mx = field(d, 'mx')
      const mn = field(d, 'mn')
      if (mx instanceof Float32Array && mn instanceof Float32Array) {
        emit(e, { type: 'peaks', job, mx, mn })
      }
      if (want === 'peaks') {
        w.terminate()
        if (e.ana === w) {
          e.ana = null
        }
      }
    } else if (t === 'info') {
      emit(e, {
        type: 'info',
        job,
        lufs: num_or(field(d, 'lufs'), -70),
        peak: num_or(field(d, 'peak'), 1),
        bpm: num_or(field(d, 'bpm'), 0),
        beat: num_or(field(d, 'beat'), 0),
        key: num_or(field(d, 'key'), -1),
        key_conf: num_or(field(d, 'key_conf'), 0),
      })
      w.terminate()
      if (e.ana === w) {
        e.ana = null
      }
    }
  }
  w.onerror = () => {
    w.terminate()
    if (e.ana === w) {
      e.ana = null
    }
  }
  const tr = []
  if (!shared) {
    for (const x of chs) {
      if (x.buffer instanceof ArrayBuffer) {
        tr.push(x.buffer)
      }
    }
  }
  w.postMessage({ ch: chs, sr, job, want }, tr)
  return job
}
export function eng_release(e) {
  e.c.pv.port.postMessage({ type: 'release' })
}
export function eng_stems(e, n, data, scale, tr) {
  e.c.pv.port.postMessage({ type: 'stems', n, data, scale }, tr)
}
export function eng_stems_clear(e) {
  e.c.pv.port.postMessage({ type: 'stems', n: 0, data: [], scale: [] })
}
export function eng_stem_gains(e, g) {
  e.c.pv.port.postMessage({ type: 'gains', g })
}
export function eng_play(e) {
  eng_resume(e)
  e.pv_playing = true
  e.c.pv.port.postMessage({ type: 'play' })
  if (e.silent_el && e.silent_el.paused) {
    e.silent_el.play().catch(() => {})
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing'
  }
}
export function eng_pause(e) {
  e.pv_playing = false
  e.c.pv.port.postMessage({ type: 'pause' })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'paused'
  }
}
export function eng_stop(e) {
  e.pv_playing = false
  e.c.pv.port.postMessage({ type: 'stop' })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none'
  }
}
export function eng_seek(e, sec) {
  if (Number.isFinite(sec)) {
    e.c.pv.port.postMessage({ type: 'seek', sec: Math.max(0, sec) })
  }
}
export function eng_set_loop(e, s, en) {
  e.c.pv.port.postMessage({ type: 'loop', s, e: en })
}
export function eng_clear_loop(e) {
  e.c.pv.port.postMessage({ type: 'noloop' })
}
export function eng_beats(e, b) {
  e.c.pv.port.postMessage({ type: 'beats', on: b.on ? 1 : 0, bpm: b.bpm, ofs: b.ofs, vol: b.vol })
}
export function eng_apply(e, m) {
  chain_apply(e.c, e.ctx, m, e.last, true)
  e.last = mix_copy(m)
}
export function eng_fade(e, to, sec) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9)
    const port = e.c.out.port
    let done = false
    const fin = () => {
      if (!done) {
        done = true
        port.removeEventListener('message', on)
        resolve()
      }
    }
    const on = (ev) => {
      const d = ev.data
      if (msg_type(d) === 'faded' && is_rec(d) && num_or(field(d, 'id'), -1) === id) {
        fin()
      }
    }
    port.addEventListener('message', on)
    port.start()
    port.postMessage({ type: 'fade', to, sec, id })
    window.setTimeout(fin, sec * 1000 + 400)
  })
}
export function eng_detect_pitch(e) {
  const n = e.analyser.fftSize
  const buf = e.pd_buf
  e.analyser.getFloatTimeDomainData(buf)
  let rms = 0
  for (let i = 0; i < n; i++) {
    rms += buf[i] * buf[i]
  }
  rms = Math.sqrt(rms / n)
  if (rms < 0.01) {
    return null
  }
  const sr = e.ctx.sampleRate
  const min_lag = Math.max(2, (sr / 1000) | 0)
  const max_lag = Math.min(1023, (sr / 70) | 0)
  const acf = e.pd_acf
  let g_max = 0
  for (let lag = min_lag; lag <= max_lag; lag++) {
    let sum = 0
    const lim = n - lag
    for (let i = 0; i < lim; i++) {
      sum += buf[i] * buf[i + lag]
    }
    sum /= lim
    acf[lag] = sum
    if (sum > g_max) {
      g_max = sum
    }
  }
  if (g_max < rms * rms * 0.3) {
    return null
  }
  let pos = -1
  const th = g_max * 0.85
  for (let lag = min_lag + 1; lag < max_lag; lag++) {
    if (acf[lag] >= th && acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1]) {
      pos = lag
      break
    }
  }
  if (pos < 0) {
    return null
  }
  const y0 = acf[pos - 1]
  const y1 = acf[pos]
  const y2 = acf[pos + 1]
  const d = y0 - 2 * y1 + y2
  const refined = d !== 0 ? pos - (y2 - y0) / (2 * d) : pos
  const hz = sr / refined
  if (hz < 60 || hz > 2000) {
    return null
  }
  const semis = 12 * Math.log2(hz / 440)
  const midi = Math.round(semis) + 69
  const cents = Math.round((semis - (midi - 69)) * 100)
  const note = (NOTE_NAMES[((midi % 12) + 12) % 12] ?? '') + String(Math.floor(midi / 12 - 1))
  return { hz: Math.round(hz * 10) / 10, note, cents }
}
export function eng_mic_active(e) {
  return e.mic_src !== null
}
export async function eng_start_mic(e) {
  if (e.mic_src) {
    return true
  }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  } catch {
    return false
  }
  e.mic_stream = stream
  e.mic_src = e.ctx.createMediaStreamSource(stream)
  e.mic_src.connect(e.mic_gain)
  eng_resume(e)
  return true
}
export function eng_stop_mic(e) {
  if (e.mic_src) {
    e.mic_src.disconnect()
    e.mic_src = null
  }
  if (e.mic_stream) {
    for (const t of e.mic_stream.getTracks()) {
      t.stop()
    }
    e.mic_stream = null
  }
}
function port_wait(port, id, ms) {
  return new Promise((resolve) => {
    let done = false
    const fin = () => {
      if (!done) {
        done = true
        port.removeEventListener('message', on)
        resolve()
      }
    }
    const on = (ev) => {
      const d = ev.data
      if (msg_type(d) === 'pong' && is_rec(d) && num_or(field(d, 'id'), -1) === id) {
        fin()
      }
    }
    port.addEventListener('message', on)
    port.start()
    window.setTimeout(fin, ms)
  })
}
export async function eng_render_offline(src, m, on_progress) {
  const sr = src.sr
  const span = Math.max(0, src.end - src.start)
  const speed = Math.max(0.01, m.pv.tempo * m.pv.rate)
  let tail = 0.3
  if (m.reverb > 0) {
    tail += ir_duration(m.reverb_type)
  }
  if (m.fx.dl_en) {
    tail += Math.min(8, (m.fx.dl_time / 1000) * (1 + 6 * m.fx.dl_fb))
  }
  const out_sec = span / speed + tail
  const out_len = Math.ceil(out_sec * sr)
  const off = new OfflineAudioContext(2, out_len, sr)
  await worklet_add(off)
  const c = chain_build(off)
  c.out.connect(off.destination)
  chain_apply(c, off, m, null, false)
  const tr = []
  const chs = []
  const i0 = Math.max(0, Math.floor(src.start * sr))
  for (const x of src.ch) {
    const i1 = Math.min(x.length, Math.ceil(src.end * sr))
    const cp = x.slice(i0, Math.max(i0 + 1, i1))
    chs.push(cp)
    if (cp.buffer instanceof ArrayBuffer) {
      tr.push(cp.buffer)
    }
  }
  c.pv.port.postMessage({ type: 'load', ch: chs, dir: m.pv.dir }, tr)
  c.pv.port.postMessage({
    type: 'params',
    pitch: m.pv.pitch,
    tempo: m.pv.tempo,
    rate: m.pv.rate,
    formant: m.pv.formant ? 1 : 0,
    dir: m.pv.dir,
  })
  c.pv.port.postMessage({ type: 'play' })
  const id = Math.floor(Math.random() * 1e9)
  const waits = [c.pv, c.fx, c.out].map((n) => {
    const p = port_wait(n.port, id, 4000)
    n.port.postMessage({ type: 'ping', id })
    return p
  })
  const step = Math.max(1, out_sec / 40)
  for (let t = step; t < out_sec - 0.05; t += step) {
    const at = t
    off.suspend(at).then(
      () => {
        on_progress(at / out_sec)
        void off.resume()
      },
      () => {},
    )
  }
  off.suspend(0).then(
    () => {
      void Promise.all(waits).then(() => off.resume())
    },
    () => {
      void Promise.all(waits)
    },
  )
  const out = await off.startRendering()
  on_progress(1)
  return out
}
export function eng_on(e, h) {
  e.listeners.push(h)
}
export function eng_off(e, h) {
  e.listeners = e.listeners.filter((x) => x !== h)
}
