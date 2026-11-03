import { fft_new, rfft, irfft, hann_periodic } from './fft.js'
const BFP = 1024
const OPFS_DIR = 'noro_models'
const S = {
  ort: null,
  base: '',
  backend: 'auto',
  man: null,
  sess: [],
  in_wave: 'mix',
  in_spec: 'spec',
  used: '',
  url: '',
  file: null,
}
function post(msg, transfer) {
  if (transfer) {
    postMessage(msg, transfer)
  } else {
    postMessage(msg)
  }
}
function status(text) {
  post({ type: 'status', text })
}
function get(o, k) {
  if ((typeof o !== 'object' && typeof o !== 'function') || o === null) {
    return undefined
  }
  return Reflect.get(o, k)
}
function str(o, k, def) {
  const v = get(o, k)
  return typeof v === 'string' ? v : def
}
function num(o, k, def) {
  const v = get(o, k)
  return typeof v === 'number' && Number.isFinite(v) ? v : def
}
function str_list(v) {
  if (!Array.isArray(v)) {
    return null
  }
  const out = []
  for (const x of v) {
    if (typeof x !== 'string') {
      return null
    }
    out.push(x)
  }
  return out
}
function num_list(v) {
  if (!Array.isArray(v)) {
    return null
  }
  const out = []
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      return null
    }
    out.push(x)
  }
  return out
}
function manifest_parse(v) {
  const sources = str_list(get(v, 'sources'))
  const models_v = get(v, 'models')
  if (!sources || sources.length === 0 || !Array.isArray(models_v) || models_v.length === 0) {
    return null
  }
  const models = []
  for (const m of models_v) {
    const file = str(m, 'file', '')
    if (file === '') {
      return null
    }
    const parts = str_list(get(m, 'parts')) ?? [file]
    const w = get(m, 'weights')
    const weights = w === null || w === undefined ? null : num_list(w)
    if (weights && weights.length !== sources.length) {
      return null
    }
    models.push({ file, parts, bytes: num(m, 'bytes', 0), weights })
  }
  const man = {
    name: str(v, 'name', 'model'),
    sr: num(v, 'samplerate', 44100),
    seg: num(v, 'segment', 343980),
    nfft: num(v, 'nfft', 4096),
    hop: num(v, 'hop', 1024),
    sources,
    models,
  }
  if (man.nfft !== man.hop * 4 || man.seg < man.hop * 8) {
    return null
  }
  return man
}
function is_ort(m) {
  const sess = get(m, 'InferenceSession')
  return (
    typeof get(sess, 'create') === 'function' &&
    typeof get(m, 'Tensor') === 'function' &&
    typeof get(m, 'env') === 'object'
  )
}
async function ort_load(base) {
  const mod = await import(base + 'ort.min.mjs')
  if (!is_ort(mod)) {
    throw new Error('onnxruntime-web を読み込めませんでした')
  }
  const env = get(mod, 'env')
  const wasm = get(env, 'wasm')
  if (typeof wasm === 'object' && wasm !== null) {
    Reflect.set(wasm, 'wasmPaths', base)
    Reflect.set(wasm, 'proxy', false)
    const threads = self.crossOriginIsolated
      ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4))
      : 1
    Reflect.set(wasm, 'numThreads', threads)
  }
  const sess = get(mod, 'InferenceSession')
  const create_fn = get(sess, 'create')
  const tensor = get(mod, 'Tensor')
  if (typeof create_fn !== 'function' || typeof tensor !== 'function') {
    throw new Error('onnxruntime-web の形式が違います')
  }
  return {
    create: async (bytes, opts) => {
      const s = await Reflect.apply(create_fn, sess, [bytes, opts])
      const run = get(s, 'run')
      const release = get(s, 'release')
      const names = str_list(get(s, 'inputNames')) ?? []
      if (typeof run !== 'function' || typeof release !== 'function') {
        throw new Error('推論セッションを作れませんでした')
      }
      return {
        run: (feeds) => Reflect.apply(run, s, [feeds]),
        release: async () => {
          await Reflect.apply(release, s, [])
        },
        inputNames: names,
      }
    },
    tensor: (data, dims) => {
      const t = Reflect.construct(tensor, ['float32', data, dims])
      if (typeof t !== 'object' || t === null) {
        throw new Error('Tensor を作れませんでした')
      }
      return t
    },
  }
}
async function opfs_dir() {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(OPFS_DIR, { create: true })
  } catch {
    return null
  }
}
async function cache_read(name, bytes) {
  const d = await opfs_dir()
  if (!d) {
    return null
  }
  try {
    const fh = await d.getFileHandle(name)
    const f = await fh.getFile()
    if (bytes > 0 && f.size !== bytes) {
      return null
    }
    if (f.size === 0) {
      return null
    }
    return new Uint8Array(await f.arrayBuffer())
  } catch {
    return null
  }
}
async function cache_write(name, data) {
  const d = await opfs_dir()
  if (!d) {
    return
  }
  try {
    const fh = await d.getFileHandle(name, { create: true })
    const h = await fh.createSyncAccessHandle()
    h.truncate(0)
    h.write(data, { at: 0 })
    h.flush()
    h.close()
  } catch {
    try {
      await d.removeEntry(name)
    } catch {}
  }
}
async function cache_clear() {
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(OPFS_DIR, { recursive: true })
  } catch {}
}
async function fetch_parts(url_base, m, idx, n_models) {
  const chunks = []
  let got = 0
  let total = m.bytes
  for (const part of m.parts) {
    const res = await fetch(new URL(part, url_base).href)
    if (!res.ok || !res.body) {
      throw new Error('モデルをダウンロードできませんでした (' + String(res.status) + ')')
    }
    if (total <= 0) {
      const cl = Number(res.headers.get('content-length') ?? '0')
      total = Number.isFinite(cl) && cl > 0 ? cl * m.parts.length : 0
    }
    const rd = res.body.getReader()
    for (;;) {
      const r = await rd.read()
      if (r.done) {
        break
      }
      chunks.push(r.value)
      got += r.value.byteLength
      post({ type: 'progress', stage: 'download', done: got, total, model: idx, models: n_models })
    }
  }
  const out = new Uint8Array(got)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.byteLength
  }
  if (m.bytes > 0 && got !== m.bytes) {
    throw new Error('モデルのサイズが一致しません')
  }
  return out
}
async function session_make(bytes, want) {
  const ort = S.ort
  if (!ort) {
    throw new Error('onnxruntime 未初期化')
  }
  const has_gpu = 'gpu' in navigator
  const order = []
  if ((want === 'auto' || want === 'webgpu') && has_gpu) {
    order.push('webgpu')
  }
  if (want !== 'webgpu' || !has_gpu) {
    order.push('wasm')
  }
  let last = null
  for (const ep of order) {
    try {
      const s = await ort.create(bytes, {
        executionProviders: [ep],
        graphOptimizationLevel: 'all',
      })
      return { s, used: ep }
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error('推論セッションを作れませんでした')
}
async function sessions_release() {
  for (const s of S.sess) {
    try {
      await s.release()
    } catch {}
  }
  S.sess = []
}
async function model_open(json_url, file) {
  await sessions_release()
  S.url = json_url
  S.file = file
  let man = null
  let file_bytes = null
  if (file) {
    file_bytes = new Uint8Array(await file.arrayBuffer())
    man = {
      name: file.name.replace(/\.[^.]+$/, ''),
      sr: 44100,
      seg: 343980,
      nfft: 4096,
      hop: 1024,
      sources: [],
      models: [
        { file: file.name, parts: [file.name], bytes: file_bytes.byteLength, weights: null },
      ],
    }
  } else {
    const res = await fetch(json_url, { cache: 'no-cache' })
    if (!res.ok) {
      throw new Error('モデル情報が見つかりません: ' + json_url)
    }
    const j = await res.json()
    man = manifest_parse(j)
    if (!man) {
      throw new Error('モデル情報の形式が違います')
    }
  }
  S.man = man
  for (let i = 0; i < man.models.length; i++) {
    const m = man.models[i]
    if (!m) {
      continue
    }
    const key = man.name + '_' + String(i) + '.onnx'
    let bytes = file_bytes
    if (!bytes) {
      status('モデルを確認中…')
      bytes = await cache_read(key, m.bytes)
      if (!bytes) {
        status('モデルをダウンロード中…')
        bytes = await fetch_parts(json_url, m, i, man.models.length)
        status('モデルを保存中…')
        await cache_write(key, bytes)
      }
    } else {
      await cache_write(key, bytes)
    }
    status('推論エンジンを準備中…')
    const r = await session_make(bytes, S.backend)
    S.sess.push(r.s)
    S.used = r.used
    const names = r.s.inputNames
    if (names.length === 2) {
      S.in_wave = names[0] ?? 'mix'
      S.in_spec = names[1] ?? 'spec'
    }
    bytes = null
  }
  post({ type: 'ready', name: man.name, sources: man.sources, backend: S.used })
}
function reflect(i, len) {
  if (i < 0) {
    i = -i
  }
  if (i >= len) {
    i = 2 * (len - 1) - i
  }
  return i < 0 ? 0 : i >= len ? len - 1 : i
}
function stft_new(nfft, hop, seg) {
  return {
    f: fft_new(nfft),
    win: hann_periodic(nfft),
    buf: new Float64Array(nfft),
    spr: new Float64Array(nfft / 2 + 1),
    spi: new Float64Array(nfft / 2 + 1),
    n: nfft,
    hop,
    bins: nfft / 2,
    frames: Math.ceil(seg / hop),
    scale: 1 / Math.sqrt(nfft),
  }
}
function spec_make(st, x, seg, out) {
  const F = st.bins
  const T = st.frames
  const n = st.n
  const pad = (st.hop >> 1) * 3
  for (let c = 0; c < 2; c++) {
    const xc = x[c]
    if (!xc) {
      continue
    }
    for (let t = 0; t < T; t++) {
      const o = t * st.hop - pad
      for (let i = 0; i < n; i++) {
        st.buf[i] = xc[reflect(o + i, seg)] * st.win[i]
      }
      rfft(st.f, st.buf, st.spr, st.spi)
      const base_re = c * 2 * F * T
      const base_im = (c * 2 + 1) * F * T
      for (let k = 0; k < F; k++) {
        out[base_re + k * T + t] = st.spr[k] * st.scale
        out[base_im + k * T + t] = st.spi[k] * st.scale
      }
    }
  }
}
function ispec_add(st, spec, s, c, seg, y) {
  const F = st.bins
  const T = st.frames
  const n = st.n
  const pad = (st.hop >> 1) * 3
  const src_re = (s * 4 + c * 2) * F * T
  const src_im = (s * 4 + c * 2 + 1) * F * T
  const g = Math.sqrt(n) / 1.5
  y.fill(0)
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < F; k++) {
      st.spr[k] = spec[src_re + k * T + t]
      st.spi[k] = spec[src_im + k * T + t]
    }
    st.spr[F] = 0
    st.spi[F] = 0
    st.spi[0] = 0
    irfft(st.f, st.spr, st.spi, st.buf)
    const o = t * st.hop - pad
    for (let i = 0; i < n; i++) {
      const j = o + i
      if (j >= 0 && j < seg) {
        y[j] += st.buf[i] * st.win[i] * g
      }
    }
  }
}
function f32_of(v) {
  const d = get(v, 'data')
  return d instanceof Float32Array ? d : null
}
function dims_of(v) {
  return num_list(get(v, 'dims')) ?? []
}
async function separate(chs, job, overlap) {
  const man = S.man
  const ort = S.ort
  if (!man || !ort || S.sess.length === 0) {
    throw new Error('モデルが読み込まれていません')
  }
  const len = chs[0]?.length ?? 0
  if (len === 0) {
    throw new Error('音声が空です')
  }
  const L = chs[0] ?? new Float32Array(0)
  const R = chs[1] ?? L
  let mean = 0
  for (let i = 0; i < len; i++) {
    mean += (L[i] + R[i]) * 0.5
  }
  mean /= len
  let vs = 0
  for (let i = 0; i < len; i++) {
    const d = (L[i] + R[i]) * 0.5 - mean
    vs += d * d
  }
  const sd = Math.sqrt(vs / Math.max(1, len - 1)) + 1e-8
  const seg = man.seg
  const stride = Math.floor((1 - overlap) * seg)
  const st = stft_new(man.nfft, man.hop, seg)
  const F = st.bins
  const T = st.frames
  const half = seg >> 1
  const weight = new Float32Array(seg)
  for (let i = 0; i < seg; i++) {
    weight[i] = (i < half ? i + 1 : seg - i) / half
  }
  let n_src = man.sources.length
  const mix = new Float32Array(2 * seg)
  const spec = new Float32Array(4 * F * T)
  const mix_l = mix.subarray(0, seg)
  const mix_r = mix.subarray(seg, 2 * seg)
  const y = new Float64Array(seg)
  const acc_len = seg + 2 * BFP
  let acc = []
  const wsum = new Float32Array(acc_len)
  let acc_start = 0
  let out = []
  let scl = []
  const n_blk = (len >> 10) + 1
  const offsets = []
  for (let off = 0; off < len; off += stride) {
    offsets.push(off)
  }
  const t_start = performance.now()
  for (let ci = 0; ci < offsets.length; ci++) {
    const off = offsets[ci] ?? 0
    const clen = Math.min(seg, len - off)
    const delta = seg - clen
    const start = off - (delta >> 1)
    for (let i = 0; i < seg; i++) {
      const p = start + i
      if (p >= 0 && p < len) {
        mix_l[i] = (L[p] - mean) / sd
        mix_r[i] = (R[p] - mean) / sd
      } else {
        mix_l[i] = 0
        mix_r[i] = 0
      }
    }
    spec_make(st, [mix_l, mix_r], seg, spec)
    const t_mix = ort.tensor(mix, [1, 2, seg])
    const t_spec = ort.tensor(spec, [1, 4, F, T])
    for (let mi = 0; mi < S.sess.length; mi++) {
      const sess = S.sess[mi]
      const mp = man.models[mi]
      if (!sess || !mp) {
        continue
      }
      const feeds = {}
      feeds[S.in_wave] = t_mix
      feeds[S.in_spec] = t_spec
      let res
      try {
        res = await sess.run(feeds)
      } catch (err) {
        if (S.used !== 'webgpu') {
          throw err
        }
        status('WebGPU で失敗したため CPU で続けます…')
        S.backend = 'wasm'
        await model_open(S.url, S.file)
        const again = S.sess[mi]
        if (!again) {
          throw err
        }
        res = await again.run(feeds)
      }
      let o_spec = null
      let o_wave = null
      let ns = 0
      if (typeof res === 'object' && res !== null) {
        for (const k of Object.keys(res)) {
          const t = Reflect.get(res, k)
          const d = dims_of(t)
          const data = f32_of(t)
          if (d.length === 5 && data) {
            o_spec = data
            ns = d[1] ?? 0
          } else if (d.length === 4 && data) {
            o_wave = data
          }
        }
      }
      if (
        !o_spec ||
        !o_wave ||
        ns <= 0 ||
        o_wave.length !== ns * 2 * seg ||
        o_spec.length !== ns * 4 * F * T
      ) {
        throw new Error('モデルの出力形式が違います')
      }
      if (acc.length === 0) {
        if (man.sources.length !== ns) {
          man.sources = default_names(ns)
        }
        n_src = ns
        for (let i = 0; i < n_src * 2; i++) {
          acc.push(new Float32Array(acc_len))
          out.push(new Int16Array(len))
          scl.push(new Float32Array(n_blk))
        }
      }
      const cut = delta >> 1
      for (let s = 0; s < n_src; s++) {
        const w_s = mp.weights ? (mp.weights[s] ?? 1) : 1
        if (w_s === 0) {
          continue
        }
        for (let c = 0; c < 2; c++) {
          ispec_add(st, o_spec, s, c, seg, y)
          const a = acc[s * 2 + c]
          if (!a) {
            continue
          }
          const wv = (s * 2 + c) * seg
          for (let j = 0; j < clen; j++) {
            const v = (y[j + cut] + o_wave[wv + j + cut]) * w_s
            a[off + j - acc_start] += weight[j] * v
          }
        }
      }
    }
    for (let j = 0; j < clen; j++) {
      wsum[off + j - acc_start] += weight[j]
    }
    const next = off + stride
    const fin_to = next >= len ? len : Math.floor(next / BFP) * BFP
    finalize(acc, wsum, acc_start, fin_to, out, scl, n_src, sd, mean, man, len)
    const shift = fin_to - acc_start
    if (shift > 0 && fin_to < len) {
      for (const a of acc) {
        a.copyWithin(0, shift)
        a.fill(0, acc_len - shift)
      }
      wsum.copyWithin(0, shift)
      wsum.fill(0, acc_len - shift)
      acc_start = fin_to
    }
    const el = (performance.now() - t_start) / 1000
    post({
      type: 'progress',
      stage: 'separate',
      done: ci + 1,
      total: offsets.length,
      elapsed: el,
      job,
    })
  }
  const data = out
  const scale = scl
  const tr = []
  for (const d of data) {
    tr.push(d.buffer)
  }
  for (const d of scale) {
    tr.push(d.buffer)
  }
  acc = []
  out = []
  scl = []
  post({ type: 'done', job, sources: man.sources, n: n_src, len, data, scale }, tr)
}
function default_names(n) {
  if (n === 4) {
    return ['drums', 'bass', 'other', 'vocals']
  }
  if (n === 6) {
    return ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
  }
  if (n === 2) {
    return ['vocals', 'accompaniment']
  }
  const out = []
  for (let i = 0; i < n; i++) {
    out.push('stem' + String(i + 1))
  }
  return out
}
function finalize(acc, wsum, acc_start, fin_to, out, scl, n_src, sd, mean, man, len) {
  for (let s = 0; s < n_src; s++) {
    let tot_w = 1
    if (man.models.length > 1) {
      tot_w = 0
      for (const m of man.models) {
        tot_w += m.weights ? (m.weights[s] ?? 1) : 1
      }
      if (tot_w <= 0) {
        tot_w = 1
      }
    }
    for (let c = 0; c < 2; c++) {
      const a = acc[s * 2 + c]
      const q = out[s * 2 + c]
      const sc = scl[s * 2 + c]
      if (!a || !q || !sc) {
        continue
      }
      for (let b0 = acc_start; b0 < fin_to; b0 += BFP) {
        const b1 = Math.min(b0 + BFP, fin_to, len)
        let pk = 0
        for (let p = b0; p < b1; p++) {
          const w = wsum[p - acc_start]
          const v = w > 0 ? (a[p - acc_start] / w / tot_w) * sd + mean : mean
          a[p - acc_start] = v
          const av = v < 0 ? -v : v
          if (av > pk) {
            pk = av
          }
        }
        const k = pk > 1e-9 ? pk / 32767 : 1e-9
        sc[b0 >> 10] = k
        const inv = 1 / k
        for (let p = b0; p < b1; p++) {
          let iv = Math.round(a[p - acc_start] * inv)
          if (iv > 32767) {
            iv = 32767
          } else if (iv < -32767) {
            iv = -32767
          }
          q[p] = iv
        }
      }
    }
  }
}
let busy = false
let queue = Promise.resolve()
self.onmessage = (e) => {
  const d = e.data
  queue = queue.then(() => handle(d))
}
async function handle(d) {
  const t = str(d, 'type', '')
  try {
    if (t === 'init') {
      S.base = str(d, 'base', '')
      S.backend = str(d, 'backend', 'auto')
      if (!S.ort) {
        status('推論エンジンを読み込み中…')
        S.ort = await ort_load(S.base)
      }
      post({ type: 'inited', isolated: self.crossOriginIsolated, gpu: 'gpu' in navigator })
    } else if (t === 'model') {
      const f = get(d, 'file')
      await model_open(str(d, 'url', ''), f instanceof File ? f : null)
    } else if (t === 'run') {
      if (busy) {
        return
      }
      busy = true
      const ch_v = get(d, 'ch')
      const chs = []
      if (Array.isArray(ch_v)) {
        for (const c of ch_v) {
          if (c instanceof Float32Array) {
            chs.push(c)
          }
        }
      }
      const sr = num(d, 'sr', 0)
      if (chs.length === 0 || !S.man || sr !== S.man.sr) {
        busy = false
        throw new Error('入力音声の形式が違います')
      }
      const ov = num(d, 'overlap', 0.25)
      await separate(chs, num(d, 'job', 0), ov > 0.1 && ov < 0.8 ? ov : 0.25)
      busy = false
    } else if (t === 'clear') {
      await sessions_release()
      await cache_clear()
      post({ type: 'cleared' })
    }
  } catch (err) {
    busy = false
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
