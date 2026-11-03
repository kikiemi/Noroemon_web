export type fft_t = {
  n: number
  m: number
  rev: Uint32Array
  tw_re: Float64Array
  tw_im: Float64Array
  uf_re: Float64Array
  uf_im: Float64Array
  wr: Float64Array
  wi: Float64Array
}

export function fft_new(n: number): fft_t {
  const m = n >> 1
  let bits = 0
  while (1 << bits < m) {
    bits++
  }
  const rev = new Uint32Array(m)
  for (let i = 0; i < m; i++) {
    let r = 0
    let x = i
    for (let k = 0; k < bits; k++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    rev[i] = r
  }
  const tw_re = new Float64Array(m >> 1)
  const tw_im = new Float64Array(m >> 1)
  for (let k = 0; k < m >> 1; k++) {
    const a = (-2 * Math.PI * k) / m
    tw_re[k] = Math.cos(a)
    tw_im[k] = Math.sin(a)
  }
  const uf_re = new Float64Array(m)
  const uf_im = new Float64Array(m)
  for (let k = 0; k < m; k++) {
    const a = (-2 * Math.PI * k) / n
    uf_re[k] = Math.cos(a)
    uf_im[k] = Math.sin(a)
  }
  return {
    n,
    m,
    rev,
    tw_re,
    tw_im,
    uf_re,
    uf_im,
    wr: new Float64Array(m),
    wi: new Float64Array(m),
  }
}

function fft_c(f: fft_t, re: Float64Array, im: Float64Array): void {
  const m = f.m
  const rev = f.rev
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
  const twr = f.tw_re
  const twi = f.tw_im
  for (let s = 1; s < m; s <<= 1) {
    const stride = (m >> 1) / s
    for (let k = 0; k < m; k += s << 1) {
      for (let j = 0; j < s; j++) {
        const t = j * stride
        const wr = twr[t]
        const wi = twi[t]
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

export function rfft(f: fft_t, x: Float64Array, spr: Float64Array, spi: Float64Array): void {
  const m = f.m
  const wr = f.wr
  const wi = f.wi
  for (let k = 0; k < m; k++) {
    wr[k] = x[2 * k]
    wi[k] = x[2 * k + 1]
  }
  fft_c(f, wr, wi)
  spr[0] = wr[0] + wi[0]
  spi[0] = 0
  spr[m] = wr[0] - wi[0]
  spi[m] = 0
  const ufr = f.uf_re
  const ufi = f.uf_im
  for (let k = 1; k < m; k++) {
    const ar = wr[k]
    const ai = wi[k]
    const br = wr[m - k]
    const bi = -wi[m - k]
    const er = (ar + br) * 0.5
    const ei = (ai + bi) * 0.5
    const or = (ar - br) * 0.5
    const oi = (ai - bi) * 0.5
    const tr = ufr[k] * or - ufi[k] * oi
    const ti = ufr[k] * oi + ufi[k] * or
    spr[k] = er + ti
    spi[k] = ei - tr
  }
}

export function irfft(f: fft_t, spr: Float64Array, spi: Float64Array, x: Float64Array): void {
  const m = f.m
  const wr = f.wr
  const wi = f.wi
  const ufr = f.uf_re
  const ufi = f.uf_im
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
    const er = (ar + br) * 0.5
    const ei = (ai + bi) * 0.5
    const or = (ar - br) * 0.5
    const oi = (ai - bi) * 0.5
    const cr = ufr[k]
    const ci = -ufi[k]
    const tr = cr * or - ci * oi
    const ti = cr * oi + ci * or
    wr[k] = er - ti
    wi[k] = -(ei + tr)
  }
  fft_c(f, wr, wi)
  const inv = 1 / m
  for (let k = 0; k < m; k++) {
    x[2 * k] = wr[k] * inv
    x[2 * k + 1] = -wi[k] * inv
  }
}

export function hann_periodic(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  }
  return w
}
