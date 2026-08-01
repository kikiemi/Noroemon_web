export const PV_WORKLET_CODE = `
'use strict'

var FFT_N = 2048
var HALF_N = 1024
var PACK_M = 1024
var SYN_HOP = 512
var OLA_NORM = 1.5
var RING = 1 << 15
var RING_M = RING - 1
var TWO_PI = Math.PI * 2
var LUT_N = 1 << 16
var LUT_K = LUT_N / TWO_PI
var AA_ROLL = 24
var MAX_GRAINS = 64
var REPORT_EVERY = 2048

var SIN_LUT = new Float32Array(LUT_N)
var COS_LUT = new Float32Array(LUT_N)
var HANN = new Float32Array(FFT_N)
var BIT_REV = new Uint16Array(PACK_M)
var TW_RE = new Float32Array(PACK_M >> 1)
var TW_IM = new Float32Array(PACK_M >> 1)
var UF_RE = new Float32Array(PACK_M)
var UF_IM = new Float32Array(PACK_M)

void (function build_tables() {
  var i, k, a
  for (i = 0; i < LUT_N; i++) {
    a = (i / LUT_N) * TWO_PI
    SIN_LUT[i] = Math.sin(a)
    COS_LUT[i] = Math.cos(a)
  }

  for (i = 0; i < FFT_N; i++) {
    HANN[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / FFT_N))
  }
  for (i = 0; i < PACK_M; i++) {
    var r = 0,
      x = i
    for (k = 0; k < 10; k++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    BIT_REV[i] = r
  }
  for (k = 0; k < PACK_M >> 1; k++) {
    a = (-TWO_PI * k) / PACK_M
    TW_RE[k] = Math.cos(a)
    TW_IM[k] = Math.sin(a)
  }
  for (k = 0; k < PACK_M; k++) {
    a = (-TWO_PI * k) / FFT_N
    UF_RE[k] = Math.cos(a)
    UF_IM[k] = Math.sin(a)
  }
})()

function fft_m(re, im) {
  var i, j, s, k, t
  for (i = 0; i < PACK_M; i++) {
    j = BIT_REV[i]
    if (j > i) {
      t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (s = 1; s < PACK_M; s <<= 1) {
    var stride = (PACK_M >> 1) / s
    for (k = 0; k < PACK_M; k += s << 1) {
      for (j = 0; j < s; j++) {
        var tw = j * stride
        var wr = TW_RE[tw],
          wi = TW_IM[tw]
        var u = k + j,
          v = u + s
        var tr = wr * re[v] - wi * im[v]
        var ti = wr * im[v] + wi * re[v]
        re[v] = re[u] - tr
        im[v] = im[u] - ti
        re[u] += tr
        im[u] += ti
      }
    }
  }
}

function ifft_m(re, im) {
  var i
  for (i = 0; i < PACK_M; i++) {
    im[i] = -im[i]
  }
  fft_m(re, im)
  var inv = 1.0 / PACK_M
  for (i = 0; i < PACK_M; i++) {
    re[i] *= inv
    im[i] = -im[i] * inv
  }
}

function rfft_fwd(x, wr, wi, spr, spi) {
  var k
  for (k = 0; k < PACK_M; k++) {
    wr[k] = x[2 * k]
    wi[k] = x[2 * k + 1]
  }
  fft_m(wr, wi)
  spr[0] = wr[0] + wi[0]
  spi[0] = 0
  spr[HALF_N] = wr[0] - wi[0]
  spi[HALF_N] = 0
  for (k = 1; k < PACK_M; k++) {
    var ar = wr[k],
      ai = wi[k]
    var br = wr[PACK_M - k],
      bi = -wi[PACK_M - k]
    var fer = (ar + br) * 0.5,
      fei = (ai + bi) * 0.5
    var for_ = (ar - br) * 0.5,
      foi = (ai - bi) * 0.5
    var tr = UF_RE[k] * for_ - UF_IM[k] * foi
    var ti = UF_RE[k] * foi + UF_IM[k] * for_
    spr[k] = fer + ti
    spi[k] = fei - tr
  }
}

function rfft_inv(spr, spi, wr, wi, x) {
  var k
  for (k = 0; k < PACK_M; k++) {
    var ar, ai, br, bi
    if (k === 0) {
      ar = spr[0]
      ai = 0
      br = spr[HALF_N]
      bi = 0
    } else {
      ar = spr[k]
      ai = spi[k]
      br = spr[PACK_M - k]
      bi = -spi[PACK_M - k]
    }
    var fer = (ar + br) * 0.5,
      fei = (ai + bi) * 0.5
    var for_ = (ar - br) * 0.5,
      foi = (ai - bi) * 0.5
    var wcr = UF_RE[k],
      wci = -UF_IM[k]
    var tr = wcr * for_ - wci * foi
    var ti = wcr * foi + wci * for_
    wr[k] = fer - ti
    wi[k] = fei + tr
  }
  ifft_m(wr, wi)
  for (k = 0; k < PACK_M; k++) {
    x[2 * k] = wr[k]
    x[2 * k + 1] = wi[k]
  }
}

function princ(a) {
  return a - TWO_PI * Math.round(a / TWO_PI)
}

function pv_state_new(sr) {
  return {
    sr: sr,
    ch: [null, null],
    n_ch: 0,
    len: 0,

    playing: false,
    draining: false,

    pitch: 1.0,
    tempo: 1.0,
    in_pos: 0,
    hop_acc: 0.0,

    loop_s: -1,
    loop_e: -1,

    ring: [new Float32Array(RING), new Float32Array(RING)],
    s_pos: 0,
    r_pos: 0.0,
    z_pos: 0,

    in_buf: new Float32Array(FFT_N),
    out_buf: new Float32Array(FFT_N),
    w_re: new Float32Array(PACK_M),
    w_im: new Float32Array(PACK_M),
    sp_re: new Float32Array(HALF_N + 1),
    sp_im: new Float32Array(HALF_N + 1),
    mag: new Float32Array(HALF_N + 1),
    ph_now: new Float32Array(HALF_N + 1),
    ph_a: [new Float32Array(HALF_N + 1), new Float32Array(HALF_N + 1)],
    ph_s: [new Float32Array(HALF_N + 1), new Float32Array(HALF_N + 1)],
    peak_of: new Int32Array(HALF_N + 1),

    report_cnt: 0,
    ended_sent: false,
  }
}

function pv_reset(st) {
  st.ring[0].fill(0)
  st.ring[1].fill(0)
  st.ph_a[0].fill(0)
  st.ph_a[1].fill(0)
  st.ph_s[0].fill(0)
  st.ph_s[1].fill(0)
  st.s_pos = 0
  st.r_pos = 0.0
  st.z_pos = 0
  st.hop_acc = 0.0
  st.draining = false
  st.ended_sent = false
}

function pv_audible_sec(st, hop_a) {
  var ahead = (st.s_pos - st.r_pos) * (hop_a / SYN_HOP)
  var p = st.in_pos - ahead
  if (p < 0) {
    p = 0
  }
  return p / st.sr
}

function pv_grain(st, hop_a) {
  var n_ch = st.n_ch < 2 ? st.n_ch : 2
  var base = st.in_pos
  var len = st.len
  var scale = SYN_HOP / hop_a
  var step = (TWO_PI * hop_a) / FFT_N
  var identity = Math.abs(st.pitch - 1.0) < 0.001 && Math.abs(st.tempo - 1.0) < 0.001
  var sp = st.s_pos
  var g = 1.0 / OLA_NORM
  var c, i, k

  for (c = 0; c < n_ch; c++) {
    var inp = st.ch[c]
    var ring = st.ring[c]

    if (identity) {
      for (i = 0; i < FFT_N; i++) {
        var si0 = base + i
        var v = si0 < len ? inp[si0] : 0
        ring[(sp + i) & RING_M] += v * HANN[i] * HANN[i] * g
      }
      continue
    }

    var in_buf = st.in_buf,
      out_buf = st.out_buf
    var spr = st.sp_re,
      spi = st.sp_im
    var mag = st.mag,
      ph_now = st.ph_now
    var ph_a = st.ph_a[c],
      ph_s = st.ph_s[c]
    var peak_of = st.peak_of

    for (i = 0; i < FFT_N; i++) {
      var si = base + i
      in_buf[i] = si < len ? inp[si] * HANN[i] : 0
    }
    rfft_fwd(in_buf, st.w_re, st.w_im, spr, spi)

    var dc_re = spr[0]
    var nyq_re = spr[HALF_N]
    for (k = 1; k < HALF_N; k++) {
      var re = spr[k],
        im = spi[k]
      mag[k] = Math.sqrt(re * re + im * im)
      var ap = Math.atan2(im, re)
      var dp = princ(ap - ph_a[k] - k * step)
      ph_a[k] = ap

      ph_s[k] = princ(ph_s[k] + (k * step + dp) * scale)
      ph_now[k] = ap
    }

    for (k = 0; k <= HALF_N; k++) {
      peak_of[k] = -1
    }
    for (k = 1; k < HALF_N - 1; k++) {
      if (mag[k] > mag[k - 1] && mag[k] > mag[k + 1] && mag[k] > 1e-7) {
        peak_of[k] = k
        for (var j = k - 1; j >= 1 && peak_of[j] < 0; j--) {
          if (mag[j] > mag[k]) {
            break
          }
          peak_of[j] = k
        }
      }
    }
    var last_pk = -1
    for (k = HALF_N - 1; k >= 1; k--) {
      if (peak_of[k] === k) {
        last_pk = k
      } else if (peak_of[k] < 0 && last_pk >= 0) {
        peak_of[k] = last_pk
      }
    }
    for (k = 1; k < HALF_N; k++) {
      var pk = peak_of[k]
      if (pk >= 0 && pk !== k) {
        ph_s[k] = princ(ph_s[pk] + (ph_now[k] - ph_now[pk]))
      }
    }

    var kc = HALF_N + 1
    if (st.pitch > 1.001) {
      kc = Math.floor(HALF_N / st.pitch)
      var k0 = kc - AA_ROLL
      if (k0 < 1) {
        k0 = 1
      }
      for (k = k0; k < kc && k < HALF_N; k++) {
        mag[k] *= 0.5 * (1 + Math.cos((Math.PI * (k - k0)) / (kc - k0)))
      }
      for (k = kc; k < HALF_N; k++) {
        mag[k] = 0
      }
      if (kc <= HALF_N) {
        nyq_re = 0
      }
    }

    spr[0] = dc_re
    spi[0] = 0
    spr[HALF_N] = nyq_re
    spi[HALF_N] = 0
    for (k = 1; k < HALF_N; k++) {
      var iph = (ph_s[k] * LUT_K) | 0
      iph = iph % LUT_N
      if (iph < 0) {
        iph += LUT_N
      }
      spr[k] = mag[k] * COS_LUT[iph]
      spi[k] = mag[k] * SIN_LUT[iph]
    }
    rfft_inv(spr, spi, st.w_re, st.w_im, out_buf)

    for (i = 0; i < FFT_N; i++) {
      ring[(sp + i) & RING_M] += out_buf[i] * HANN[i] * g
    }
  }

  if (n_ch === 1) {
    var r0 = st.ring[0],
      r1 = st.ring[1]
    for (i = 0; i < FFT_N; i++) {
      var ri = (sp + i) & RING_M
      r1[ri] = r0[ri]
    }
  }

  st.in_pos += hop_a
  st.s_pos += SYN_HOP
}

function pv_pump(st, need_out) {
  var hop_exact = (SYN_HOP * st.tempo) / st.pitch
  var hop_a = hop_exact | 0
  var produced = 0

  var target = st.r_pos + need_out * st.pitch + 2 + SYN_HOP

  while (!st.draining && st.s_pos <= target && produced < MAX_GRAINS) {
    if (st.loop_e > 0 && st.loop_s >= 0 && st.in_pos >= st.loop_e) {
      st.in_pos = st.loop_s
    }
    if (st.in_pos >= st.len) {
      if (st.loop_e > 0 && st.loop_s >= 0) {
        st.in_pos = st.loop_s
      } else {
        st.draining = true
        break
      }
    }

    st.hop_acc += hop_exact
    hop_a = st.hop_acc | 0
    if (hop_a < 1) {
      hop_a = 1
    }
    st.hop_acc -= hop_a

    pv_grain(st, hop_a)
    produced++
  }
  return hop_a > 0 ? hop_a : hop_exact > 1 ? hop_exact : 1
}

function pv_read_out(st, out_l, out_r, n) {
  var ring_l = st.ring[0],
    ring_r = st.ring[1]
  var pitch = st.pitch
  var rp = st.r_pos
  var limit = st.draining ? st.s_pos - 2 : Infinity
  var i
  var wrote = n

  for (i = 0; i < n; i++) {
    if (rp >= limit) {
      wrote = i
      break
    }
    var r1 = rp | 0
    var fr = rp - r1
    var i0 = (r1 - 1) & RING_M
    var i1 = r1 & RING_M
    var i2 = (r1 + 1) & RING_M
    var i3 = (r1 + 2) & RING_M

    var a0 = ring_l[i0],
      a1 = ring_l[i1],
      a2 = ring_l[i2],
      a3 = ring_l[i3]
    out_l[i] =
      a1 +
      0.5 * fr * (a2 - a0 + fr * (2 * a0 - 5 * a1 + 4 * a2 - a3 + fr * (3 * (a1 - a2) + a3 - a0)))
    var b0 = ring_r[i0],
      b1 = ring_r[i1],
      b2 = ring_r[i2],
      b3 = ring_r[i3]
    out_r[i] =
      b1 +
      0.5 * fr * (b2 - b0 + fr * (2 * b0 - 5 * b1 + 4 * b2 - b3 + fr * (3 * (b1 - b2) + b3 - b0)))

    rp += pitch
  }
  st.r_pos = rp

  var zt = (rp | 0) - 4
  var zp = st.z_pos
  while (zp < zt) {
    var zi = zp & RING_M
    ring_l[zi] = 0
    ring_r[zi] = 0
    zp++
  }
  st.z_pos = zp
  return wrote
}

class PvProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.st = pv_state_new(sampleRate)
    this.port.onmessage = (e) => {
      pv_msg(this, this.st, e.data)
    }
  }
  process(ins_, outs, params_) {
    return pv_process(this, this.st, outs[0])
  }
}

function pv_msg(node, st, d) {
  switch (d.type) {
    case 'loadBuffer': {
      st.ch[0] = d.channels[0] || null
      st.ch[1] = d.channels[1] || null
      st.n_ch = d.channels.length
      st.len = st.ch[0] ? st.ch[0].length : 0
      st.in_pos = 0
      st.loop_s = -1
      st.loop_e = -1
      pv_reset(st)
      node.port.postMessage({ type: 'loaded', duration: st.len / st.sr })
      break
    }
    case 'play':
      st.playing = true
      break
    case 'pause':
      st.playing = false
      break
    case 'stop':
      st.playing = false
      st.in_pos = 0
      pv_reset(st)
      break
    case 'seek': {
      var p = Math.floor(d.position)
      if (!isFinite(p)) {
        break
      }
      if (p < 0) {
        p = 0
      }
      if (p > st.len - 1) {
        p = st.len - 1
      }
      if (p < 0) {
        p = 0
      }
      st.in_pos = p
      pv_reset(st)
      break
    }
    case 'setPitch': {
      var r = Math.pow(2, d.semitones / 12)
      if (r < 0.25) {
        r = 0.25
      }
      if (r > 4.0) {
        r = 4.0
      }
      st.pitch = r
      break
    }
    case 'setTempo': {
      var t = d.tempo
      if (t < 0.25) {
        t = 0.25
      }
      if (t > 4.0) {
        t = 4.0
      }
      st.tempo = t
      break
    }
    case 'setLoop': {
      var ls = Math.floor(d.start * st.sr)
      var le = Math.floor(d.end * st.sr)
      if (!isFinite(ls) || !isFinite(le)) {
        break
      }
      if (ls < 0) {
        ls = 0
      }
      if (le > st.len) {
        le = st.len
      }
      if (le - ls < 128) {
        st.loop_s = -1
        st.loop_e = -1
        break
      }
      st.loop_s = ls
      st.loop_e = le
      break
    }
    case 'clearLoop':
      st.loop_s = -1
      st.loop_e = -1
      break
    case 'reverse': {
      var c
      for (c = 0; c < st.n_ch && c < 2; c++) {
        if (st.ch[c]) {
          st.ch[c].reverse()
        }
      }
      st.in_pos = st.len - st.in_pos
      if (st.in_pos < 0) {
        st.in_pos = 0
      }
      if (st.in_pos > st.len - 1 && st.len > 0) {
        st.in_pos = st.len - 1
      }

      if (st.loop_e > 0 && st.loop_s >= 0) {
        var ns = st.len - st.loop_e
        var ne = st.len - st.loop_s
        st.loop_s = ns < 0 ? 0 : ns
        st.loop_e = ne
      }
      pv_reset(st)
      break
    }
  }
}

function pv_process(node, st, out) {
  var out_l = out[0]
  var out_r = out.length > 1 ? out[1] : out[0]
  var n = out_l.length
  var c

  if (!st.playing || st.n_ch === 0 || st.len === 0) {
    for (c = 0; c < out.length; c++) {
      out[c].fill(0)
    }
    return true
  }

  var hop_a = pv_pump(st, n)
  var wrote = pv_read_out(st, out_l, out_r, n)

  if (wrote < n) {
    for (var i = wrote; i < n; i++) {
      out_l[i] = 0
      out_r[i] = 0
    }
    if (st.draining && !st.ended_sent) {
      st.ended_sent = true
      st.playing = false
      node.port.postMessage({ type: 'ended' })
    }
  }

  st.report_cnt += n
  if (st.report_cnt >= REPORT_EVERY) {
    st.report_cnt = 0
    node.port.postMessage({
      type: 'position',
      position: pv_audible_sec(st, hop_a),
      total: st.len / st.sr,
    })
  }
  return true
}

registerProcessor('pv-processor', PvProcessor)
`
