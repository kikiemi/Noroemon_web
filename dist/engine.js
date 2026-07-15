import { clamp, semis_to_ratio } from './types.js'
import { PV_WORKLET_CODE } from './dsp/pv_worklet.js'
import {
  BITCRUSHER_CODE,
  VOCAL_CANCEL_CODE,
  FORMANT_CODE,
  MODULATION_CODE,
  COMPRESSOR_CODE,
} from './dsp/fx_worklets.js'
import { BPM_WORKER_CODE } from './dsp/bpm_worker.js'
import { EQ_BANDS } from './types.js'
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const ALL_WORKLETS = [
  PV_WORKLET_CODE,
  FORMANT_CODE,
  BITCRUSHER_CODE,
  VOCAL_CANCEL_CODE,
  MODULATION_CODE,
  COMPRESSOR_CODE,
]
async function worklet_add(ctx, code) {
  const blob_url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(blob_url)
    return
  } catch {
  } finally {
    URL.revokeObjectURL(blob_url)
  }
  const b64 = btoa(unescape(encodeURIComponent(code)))
  await ctx.audioWorklet.addModule('data:application/javascript;base64,' + b64)
}
function param_set(node, name, v, t) {
  const p = node.parameters.get(name)
  if (p) {
    p.setValueAtTime(v, t)
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
    f.gain.value = gains ? (gains[i] ?? 0) : 0
    return f
  })
}
function make_reverb_ir(ctx, dur, decay) {
  const rate = ctx.sampleRate
  const len = (rate * dur) | 0
  const ir = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: rate })
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return ir
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
    s += String.fromCharCode(bytes[i])
  }
  return 'data:audio/wav;base64,' + btoa(s)
}
function emit(e, ev) {
  for (const h of e.listeners) {
    h(ev)
  }
}
export async function eng_init() {
  const ctx = new AudioContext({ sampleRate: 44100 })
  for (const code of ALL_WORKLETS) {
    await worklet_add(ctx, code)
  }
  const w_src = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }
  const w_fx = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }
  const e = {
    ctx,
    pv: new AudioWorkletNode(ctx, 'pv-processor', w_src),
    fm: new AudioWorkletNode(ctx, 'fm-processor', w_fx),
    vc: new AudioWorkletNode(ctx, 'vc-processor', w_fx),
    md: new AudioWorkletNode(ctx, 'md-processor', w_fx),
    bc: new AudioWorkletNode(ctx, 'bc-processor', w_fx),
    cp: new AudioWorkletNode(ctx, 'cp-processor', w_fx),
    fx_in: ctx.createGain(),
    eqs: make_eq(ctx, null),
    conv: ctx.createConvolver(),
    wet: ctx.createGain(),
    dry: ctx.createGain(),
    mix: ctx.createGain(),
    master: ctx.createGain(),
    analyser: ctx.createAnalyser(),
    mic_gain: ctx.createGain(),
    mic_src: null,
    mic_stream: null,
    silent_el: null,
    bpm_worker: null,
    bpm_job: 0,
    listeners: [],
    duration: 0,
    sr: 44100,
    pd_buf: new Float32Array(2048),
    pd_acf: new Float32Array(1024),
  }
  e.conv.buffer = make_reverb_ir(ctx, 2.5, 3)
  e.wet.gain.value = 0
  e.dry.gain.value = 1
  e.master.gain.value = 0.8
  e.analyser.fftSize = 2048
  e.analyser.smoothingTimeConstant = 0.8
  e.pv.connect(e.fm)
  e.fm.connect(e.fx_in)
  e.mic_gain.connect(e.fx_in)
  let node = e.fx_in
  node.connect(e.vc)
  node = e.vc
  for (const eq of e.eqs) {
    node.connect(eq)
    node = eq
  }
  node.connect(e.md)
  e.md.connect(e.bc)
  e.bc.connect(e.cp)
  e.cp.connect(e.dry)
  e.cp.connect(e.conv)
  e.conv.connect(e.wet)
  e.dry.connect(e.mix)
  e.wet.connect(e.mix)
  e.mix.connect(e.master)
  e.master.connect(e.analyser)
  e.analyser.connect(ctx.destination)
  e.pv.port.onmessage = (ev) => {
    const d = ev.data
    if (d.type === 'position') {
      emit(e, { type: 'position', current: d.position ?? 0, total: d.total ?? 0 })
    } else if (d.type === 'ended') {
      emit(e, { type: 'ended' })
    } else if (d.type === 'loaded') {
      e.duration = d.duration ?? 0
      emit(e, { type: 'loaded', duration: e.duration })
    }
  }
  const sil = document.createElement('audio')
  sil.src = make_silent_wav_uri(2)
  sil.loop = true
  sil.volume = 0.001
  sil.setAttribute('playsinline', '')
  sil.setAttribute('webkit-playsinline', '')
  document.body.appendChild(sil)
  e.silent_el = sil
  const nav = navigator
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback'
    } catch {}
  }
  return e
}
export async function eng_decode(e, buf) {
  if (e.ctx.state === 'suspended') {
    try {
      await e.ctx.resume()
    } catch {}
  }
  return e.ctx.decodeAudioData(buf)
}
export async function eng_load_buffer(e, ab) {
  if (e.ctx.state === 'suspended') {
    await e.ctx.resume()
  }
  e.sr = ab.sampleRate
  e.duration = ab.duration
  const channels = []
  for (let c = 0; c < ab.numberOfChannels; c++) {
    channels.push(ab.getChannelData(c).slice())
  }
  e.pv.port.postMessage(
    { type: 'loadBuffer', channels, sampleRate: ab.sampleRate },
    channels.map((c) => c.buffer),
  )
}
export function eng_play(e) {
  if (e.ctx.state === 'suspended') {
    void e.ctx.resume()
  }
  e.pv.port.postMessage({ type: 'play' })
  if (e.silent_el && e.silent_el.paused) {
    e.silent_el.play().catch(() => {})
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'playing'
  }
}
export function eng_pause(e) {
  e.pv.port.postMessage({ type: 'pause' })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'paused'
  }
}
export function eng_stop(e) {
  e.pv.port.postMessage({ type: 'stop' })
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none'
  }
}
export function eng_seek(e, sec) {
  e.pv.port.postMessage({ type: 'seek', position: sec * e.sr })
}
export function eng_set_pitch(e, semis) {
  e.pv.port.postMessage({ type: 'setPitch', semitones: clamp(semis, -24, 24) })
}
export function eng_set_tempo(e, f) {
  e.pv.port.postMessage({ type: 'setTempo', tempo: clamp(f, 0.25, 4) })
}
export function eng_set_volume(e, v) {
  e.master.gain.setTargetAtTime(clamp(v, 0, 1), e.ctx.currentTime, 0.02)
}
export function eng_set_loop(e, s, en) {
  e.pv.port.postMessage({ type: 'setLoop', start: s, end: en })
}
export function eng_clear_loop(e) {
  e.pv.port.postMessage({ type: 'clearLoop' })
}
export function eng_reverse(e) {
  e.pv.port.postMessage({ type: 'reverse' })
}
export function eng_set_eq_band(e, i, db) {
  const f = e.eqs[i]
  if (f) {
    f.gain.setTargetAtTime(clamp(db, -12, 12), e.ctx.currentTime, 0.02)
  }
}
export function eng_set_eq_all(e, gains) {
  gains.forEach((g, i) => eng_set_eq_band(e, i, g))
}
export function eng_set_reverb(e, w) {
  const t = e.ctx.currentTime
  const ww = clamp(w, 0, 1)
  e.wet.gain.setTargetAtTime(ww, t, 0.03)
  e.dry.gain.setTargetAtTime(1 - ww * 0.5, t, 0.03)
}
export function eng_set_bitcrusher(e, bits, red, en) {
  const t = e.ctx.currentTime
  param_set(e.bc, 'bits', clamp(bits, 1, 16), t)
  param_set(e.bc, 'reduction', clamp(red, 1, 64), t)
  param_set(e.bc, 'enabled', en ? 1 : 0, t)
}
export function eng_set_vocal_cancel(e, en) {
  param_set(e.vc, 'enabled', en ? 1 : 0, e.ctx.currentTime)
}
export function eng_set_formant(e, en, pitch_semis) {
  const t = e.ctx.currentTime
  param_set(e.fm, 'enabled', en ? 1 : 0, t)
  param_set(e.fm, 'pitchRatio', semis_to_ratio(pitch_semis), t)
}
export function eng_set_modulation(e, s) {
  const t = e.ctx.currentTime
  const modes = { fl: 0, ch: 1, ph: 2 }
  param_set(e.md, 'mode', modes[s.mode] ?? 0, t)
  param_set(e.md, 'rate', s.rate, t)
  param_set(e.md, 'depth', s.depth, t)
  param_set(e.md, 'feedback', s.fb, t)
  param_set(e.md, 'mix', s.mix, t)
  param_set(e.md, 'enabled', s.en ? 1 : 0, t)
}
export function eng_set_compressor(e, s) {
  const t = e.ctx.currentTime
  param_set(e.cp, 'threshold', s.thr, t)
  param_set(e.cp, 'ratio', s.rat, t)
  param_set(e.cp, 'attack', s.atk, t)
  param_set(e.cp, 'release', s.rel, t)
  param_set(e.cp, 'makeup', s.mkup, t)
  param_set(e.cp, 'enabled', s.en ? 1 : 0, t)
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
  const y0 = acf[pos - 1],
    y1 = acf[pos],
    y2 = acf[pos + 1]
  const d = y0 - 2 * y1 + y2
  const refined = d !== 0 ? pos - (y2 - y0) / (2 * d) : pos
  const hz = sr / refined
  if (hz < 60 || hz > 2000) {
    return null
  }
  const semis = 12 * Math.log2(hz / 440)
  const midi = Math.round(semis) + 69
  const cents = Math.round((semis - (midi - 69)) * 100)
  const note = NOTE_NAMES[((midi % 12) + 12) % 12] + String(Math.floor(midi / 12 - 1))
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
  if (e.ctx.state === 'suspended') {
    await e.ctx.resume()
  }
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
export function eng_detect_bpm(e, ch0, sr) {
  const job = ++e.bpm_job
  if (e.bpm_worker) {
    e.bpm_worker.terminate()
    e.bpm_worker = null
  }
  const blob = new Blob([BPM_WORKER_CODE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  const w = new Worker(url)
  URL.revokeObjectURL(url)
  e.bpm_worker = w
  w.postMessage({ sampleRate: sr, channel: ch0 }, [ch0.buffer])
  w.onmessage = (ev) => {
    const d = ev.data
    if (d.type === 'bpm' && job === e.bpm_job) {
      emit(e, { type: 'bpm', value: d.value })
    }
    w.terminate()
    if (e.bpm_worker === w) {
      e.bpm_worker = null
    }
  }
}
export async function eng_render_offline(e, audio_data, st) {
  const decoded = await eng_decode(e, audio_data.slice(0))
  const sr = decoded.sampleRate
  const out_len = Math.ceil((decoded.duration / st.tempo) * sr) + 16384
  const n_ch = decoded.numberOfChannels
  const off = new OfflineAudioContext(n_ch, out_len, sr)
  for (const code of ALL_WORKLETS) {
    await worklet_add(off, code)
  }
  const w_src = { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [n_ch] }
  const w_fx = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [n_ch] }
  const pv = new AudioWorkletNode(off, 'pv-processor', w_src)
  const fm = new AudioWorkletNode(off, 'fm-processor', w_fx)
  const vc = new AudioWorkletNode(off, 'vc-processor', w_fx)
  const md = new AudioWorkletNode(off, 'md-processor', w_fx)
  const bc = new AudioWorkletNode(off, 'bc-processor', w_fx)
  const cp = new AudioWorkletNode(off, 'cp-processor', w_fx)
  const eqs = make_eq(off, st.eqGains)
  const conv = off.createConvolver()
  conv.buffer = make_reverb_ir(off, 2.5, 3)
  const wet = off.createGain()
  const dry = off.createGain()
  const mix = off.createGain()
  wet.gain.value = clamp(st.reverb, 0, 1)
  dry.gain.value = 1 - st.reverb * 0.5
  pv.connect(fm)
  let node = fm
  node.connect(vc)
  node = vc
  for (const eq of eqs) {
    node.connect(eq)
    node = eq
  }
  node.connect(md)
  md.connect(bc)
  bc.connect(cp)
  cp.connect(dry)
  cp.connect(conv)
  conv.connect(wet)
  dry.connect(mix)
  wet.connect(mix)
  mix.connect(off.destination)
  const channels = []
  for (let c = 0; c < n_ch; c++) {
    channels.push(decoded.getChannelData(c).slice())
  }
  pv.port.postMessage(
    { type: 'loadBuffer', channels, sampleRate: sr },
    channels.map((c) => c.buffer),
  )
  pv.port.postMessage({ type: 'setPitch', semitones: st.pitch })
  pv.port.postMessage({ type: 'setTempo', tempo: st.tempo })
  if (st.reverse) {
    pv.port.postMessage({ type: 'reverse' })
  }
  pv.port.postMessage({ type: 'play' })
  param_set(vc, 'enabled', st.vocalCancel ? 1 : 0, 0)
  param_set(bc, 'bits', st.bitcrusherBits, 0)
  param_set(bc, 'reduction', st.bitcrusherReduction, 0)
  param_set(bc, 'enabled', st.bitcrusherEnabled ? 1 : 0, 0)
  param_set(fm, 'enabled', st.formant ? 1 : 0, 0)
  param_set(fm, 'pitchRatio', semis_to_ratio(st.pitch), 0)
  param_set(md, 'mode', { fl: 0, ch: 1, ph: 2 }[st.mod.mode] ?? 0, 0)
  param_set(md, 'rate', st.mod.rate, 0)
  param_set(md, 'depth', st.mod.depth, 0)
  param_set(md, 'feedback', st.mod.fb, 0)
  param_set(md, 'mix', st.mod.mix, 0)
  param_set(md, 'enabled', st.mod.en ? 1 : 0, 0)
  param_set(cp, 'threshold', st.comp.thr, 0)
  param_set(cp, 'ratio', st.comp.rat, 0)
  param_set(cp, 'attack', st.comp.atk, 0)
  param_set(cp, 'release', st.comp.rel, 0)
  param_set(cp, 'makeup', st.comp.mkup, 0)
  param_set(cp, 'enabled', st.comp.en ? 1 : 0, 0)
  return off.startRendering()
}
export function eng_on(e, h) {
  e.listeners.push(h)
}
export function eng_off(e, h) {
  e.listeners = e.listeners.filter((x) => x !== h)
}
export async function eng_dispose(e) {
  eng_stop_mic(e)
  const nodes = [
    e.pv,
    e.fm,
    e.vc,
    e.md,
    e.bc,
    e.cp,
    e.fx_in,
    e.mic_gain,
    e.conv,
    e.wet,
    e.dry,
    e.mix,
    e.master,
    e.analyser,
  ]
  for (const n of nodes) {
    n?.disconnect()
  }
  for (const n of e.eqs) {
    n.disconnect()
  }
  e.bpm_worker?.terminate()
  e.silent_el?.remove()
  await e.ctx.close()
}
