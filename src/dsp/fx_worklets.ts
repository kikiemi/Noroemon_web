export const BITCRUSHER_CODE = `
'use strict'
class BcProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'reduction', defaultValue: 1, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.hold = [0, 0]
    this.cnt = 0
  }
  process(ins, outs, pm) {
    var inp = ins[0],
      out = outs[0]
    if (!inp || !inp[0]) {
      return true
    }
    if ((pm.enabled[0] || 0) < 0.5) {
      for (var c = 0; c < out.length; c++) {
        out[c].set(inp[c] || inp[0])
      }
      return true
    }
    var bits = pm.bits[0] || 16
    var red = Math.max(1, Math.floor(pm.reduction[0] || 1))
    var step = Math.pow(0.5, bits)
    var n = out[0].length
    var nc = Math.min(out.length, 2)
    for (var i = 0; i < n; i++) {
      this.cnt++
      var latch = this.cnt >= red
      if (latch) {
        this.cnt = 0
      }
      for (var ch = 0; ch < nc; ch++) {
        var x = (inp[ch] || inp[0])[i]
        if (latch) {
          this.hold[ch] = Math.round(x / step) * step
        }
        out[ch][i] = this.hold[ch]
      }
    }
    for (var cc = nc; cc < out.length; cc++) {
      out[cc].set(out[0])
    }
    return true
  }
}
registerProcessor('bc-processor', BcProcessor)
`

export const VOCAL_CANCEL_CODE = `
'use strict'
class VcProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }
  process(ins, outs, pm) {
    var inp = ins[0],
      out = outs[0]
    if (!inp || !inp[0]) {
      return true
    }
    if ((pm.enabled[0] || 0) < 0.5 || inp.length < 2) {
      for (var c = 0; c < out.length; c++) {
        out[c].set(inp[c] || inp[0])
      }
      return true
    }
    var L = inp[0],
      R = inp[1]
    var n = L.length
    for (var i = 0; i < n; i++) {
      var d = (L[i] - R[i]) * 0.7071
      out[0][i] = d
      if (out.length > 1) {
        out[1][i] = d
      }
    }
    return true
  }
}
registerProcessor('vc-processor', VcProcessor)
`

export const FORMANT_CODE = `
'use strict'
var FS = 2048
var HALF = FS >> 1
var HP = FS >> 2
var OB = FS * 3
var LQ = 40
var EPS = 1e-10
var TWO_PI = Math.PI * 2

var WIN = new Float32Array(FS)
void (function () {
  for (var i = 0; i < FS; i++) {
    WIN[i] = 0.5 * (1 - Math.cos((TWO_PI * i) / FS))
  }
})()

function fftc(re, im, inv) {
  var n = FS,
    i,
    j,
    m,
    t
  j = 0
  for (i = 0; i < n; i++) {
    if (i < j) {
      t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
    m = n >> 1
    while (m >= 1 && j >= m) {
      j -= m
      m >>= 1
    }
    j += m
  }
  for (var s = 2; s <= n; s <<= 1) {
    var h = s >> 1
    var a = ((inv ? 1 : -1) * Math.PI) / h
    for (var j0 = 0; j0 < h; j0++) {
      var wr = Math.cos(a * j0),
        wi = Math.sin(a * j0)
      for (var k = j0; k < n; k += s) {
        var v = k + h
        var tr = wr * re[v] - wi * im[v]
        var ti = wr * im[v] + wi * re[v]
        re[v] = re[k] - tr
        im[v] = im[k] - ti
        re[k] += tr
        im[k] += ti
      }
    }
  }
  if (inv) {
    for (i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

class FmProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      {
        name: 'pitchRatio',
        defaultValue: 1,
        minValue: 0.25,
        maxValue: 4,
        automationRate: 'k-rate',
      },
    ]
  }
  constructor() {
    super()
    this.ib = [new Float32Array(FS), new Float32Array(FS)]
    this.ob = [new Float32Array(OB), new Float32Array(OB)]
    this.wp = 0
    this.rp = 0
    this.ow = HP * 3
    this.cnt = 0
    this.re = new Float32Array(FS)
    this.im = new Float32Array(FS)
    this.r2 = new Float32Array(FS)
    this.i2 = new Float32Array(FS)
    this.cr = new Float32Array(FS)
    this.ci = new Float32Array(FS)
    this.env = new Float32Array(HALF + 1)
    this.cor = new Float32Array(HALF + 1)
  }

  frame(pr, nc) {
    var re = this.re,
      im = this.im,
      cr = this.cr,
      ci = this.ci
    var env = this.env,
      cor = this.cor
    var i, k

    for (i = 0; i < FS; i++) {
      var idx = (this.wp - FS + i + FS * 2) % FS
      re[i] = this.ib[0][idx] * WIN[i]
      im[i] = 0
    }
    fftc(re, im, false)
    for (i = 0; i < FS; i++) {
      cr[i] = Math.log(Math.sqrt(re[i] * re[i] + im[i] * im[i]) + EPS)
      ci[i] = 0
    }
    fftc(cr, ci, true)
    for (i = LQ; i < FS - LQ; i++) {
      cr[i] = 0
      ci[i] = 0
    }
    fftc(cr, ci, false)
    for (k = 0; k <= HALF; k++) {
      env[k] = cr[k]
    }

    for (k = 0; k <= HALF; k++) {
      var si = k * pr
      var tgt
      if (si >= HALF) {
        tgt = env[HALF]
      } else {
        var i0 = si | 0
        var fr = si - i0
        tgt = env[i0] * (1 - fr) + env[i0 + 1] * fr
      }
      var g = Math.exp(tgt - env[k])

      if (g > 8) {
        g = 8
      }
      if (g < 0.125) {
        g = 0.125
      }
      cor[k] = g
    }

    var r2 = this.r2,
      i2 = this.i2
    for (var c = 0; c < nc; c++) {
      for (i = 0; i < FS; i++) {
        var idx2 = (this.wp - FS + i + FS * 2) % FS
        r2[i] = this.ib[c][idx2] * WIN[i]
        i2[i] = 0
      }
      fftc(r2, i2, false)
      for (k = 0; k < FS; k++) {
        var kk = k <= HALF ? k : FS - k
        r2[k] *= cor[kk]
        i2[k] *= cor[kk]
      }
      fftc(r2, i2, true)
      for (i = 0; i < FS; i++) {
        this.ob[c][(this.ow + i) % OB] += r2[i] * WIN[i] * (1 / 1.5)
      }
    }
    this.ow = (this.ow + HP) % OB
  }

  process(ins, outs, pm) {
    var inp = ins[0],
      out = outs[0]
    if (!inp || !inp[0]) {
      for (var z = 0; z < out.length; z++) {
        out[z].fill(0)
      }
      return true
    }
    var en = (pm.enabled[0] || 0) >= 0.5
    var pr = pm.pitchRatio[0] || 1
    var n = inp[0].length
    var nc = Math.min(inp.length, out.length, 2)
    if (!en || Math.abs(pr - 1) < 0.02) {
      for (var c = 0; c < out.length; c++) {
        out[c].set(inp[c] || inp[0])
      }
      return true
    }
    for (var i = 0; i < n; i++) {
      for (var c2 = 0; c2 < nc; c2++) {
        this.ib[c2][this.wp] = inp[c2] ? inp[c2][i] : inp[0][i]
      }
      this.wp = (this.wp + 1) % FS
      this.cnt++
      if (this.cnt >= HP) {
        this.cnt = 0
        this.frame(pr, nc)
      }
      for (var c3 = 0; c3 < nc; c3++) {
        out[c3][i] = this.ob[c3][this.rp]
        this.ob[c3][this.rp] = 0
      }
      this.rp = (this.rp + 1) % OB
    }
    for (var c4 = nc; c4 < out.length; c4++) {
      out[c4].set(out[0])
    }
    return true
  }
}
registerProcessor('fm-processor', FmProcessor)
`

export const MODULATION_CODE = `
'use strict'
var MDL = 4096,
  MMK = MDL - 1,
  APS = 6
class MdProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'rate', defaultValue: 0.5, minValue: 0.01, maxValue: 10, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      {
        name: 'feedback',
        defaultValue: 0.3,
        minValue: -0.95,
        maxValue: 0.95,
        automationRate: 'k-rate',
      },
      { name: 'mix', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.dl = [new Float32Array(MDL), new Float32Array(MDL)]
    this.dp = 0
    this.lfo = 0
    this.ax = [new Float32Array(APS), new Float32Array(APS)]
    this.ay = [new Float32Array(APS), new Float32Array(APS)]
  }
  process(ins, outs, pm) {
    var inp = ins[0],
      out = outs[0]
    if (!inp || !inp[0]) {
      for (var z = 0; z < out.length; z++) {
        out[z].fill(0)
      }
      return true
    }
    if ((pm.enabled[0] || 0) < 0.5) {
      for (var c = 0; c < out.length; c++) {
        out[c].set(inp[c] || inp[0])
      }
      return true
    }
    var md = (pm.mode[0] || 0) | 0
    var rt = pm.rate[0] || 0.5
    var dp_ = pm.depth[0] !== undefined ? pm.depth[0] : 0.5
    var fb = pm.feedback[0] !== undefined ? pm.feedback[0] : 0.3
    var mx = pm.mix[0] !== undefined ? pm.mix[0] : 0.5
    var n = inp[0].length
    var nc = Math.min(inp.length, out.length, 2)
    var l_inc = rt / sampleRate

    for (var i = 0; i < n; i++) {
      var lv = Math.sin(this.lfo * Math.PI * 2)
      this.lfo = (this.lfo + l_inc) % 1

      for (var ch = 0; ch < nc; ch++) {
        var x = inp[ch] ? inp[ch][i] : inp[0][i]
        var wet
        if (md < 2) {
          var base = md === 0 ? 44 : 882
          var mod = md === 0 ? dp_ * 220 : dp_ * 662
          var dly = Math.max(1, base + lv * mod)
          var rp = this.dp - dly
          while (rp < 0) {
            rp += MDL
          }
          var i1 = rp | 0
          var fr = rp - i1
          var y0 = this.dl[ch][(i1 - 1 + MDL) & MMK]
          var y1 = this.dl[ch][i1 & MMK]
          var y2 = this.dl[ch][(i1 + 1) & MMK]
          var y3 = this.dl[ch][(i1 + 2) & MMK]
          wet =
            (((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * fr + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * fr +
              0.5 * (y2 - y0)) *
              fr +
            y1
          this.dl[ch][this.dp] = x + wet * fb
        } else {
          var f = 200 + (0.5 + 0.5 * lv) * 3800
          var tn = Math.tan((Math.PI * f) / sampleRate)
          var a = (tn - 1) / (tn + 1)
          wet = x
          for (var s = 0; s < APS; s++) {
            var xp = this.ax[ch][s],
              yp = this.ay[ch][s]
            var yn = -a * wet + xp + a * yp
            this.ax[ch][s] = wet
            this.ay[ch][s] = yn
            wet = yn
          }
        }
        out[ch][i] = x * (1 - mx) + wet * mx
      }
      for (var cc = nc; cc < out.length; cc++) {
        out[cc][i] = out[0][i]
      }
      this.dp = (this.dp + 1) & MMK
    }
    return true
  }
}
registerProcessor('md-processor', MdProcessor)
`

export const COMPRESSOR_CODE = `
'use strict'
class CpProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'threshold',
        defaultValue: -10,
        minValue: -60,
        maxValue: 0,
        automationRate: 'k-rate',
      },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 10, minValue: 0.1, maxValue: 200, automationRate: 'k-rate' },
      {
        name: 'release',
        defaultValue: 100,
        minValue: 10,
        maxValue: 2000,
        automationRate: 'k-rate',
      },
      { name: 'makeup', defaultValue: 0, minValue: 0, maxValue: 40, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.env = 0
  }
  process(ins, outs, pm) {
    var inp = ins[0],
      out = outs[0]
    if (!inp || !inp[0]) {
      for (var z = 0; z < out.length; z++) {
        out[z].fill(0)
      }
      return true
    }
    if ((pm.enabled[0] || 0) < 0.5) {
      for (var c = 0; c < out.length; c++) {
        out[c].set(inp[c] || inp[0])
      }
      return true
    }
    var thr = pm.threshold[0] !== undefined ? pm.threshold[0] : -10
    var rat = pm.ratio[0] || 4
    var atk = pm.attack[0] || 10
    var rel = pm.release[0] || 100
    var mkup = pm.makeup[0] || 0
    var n = inp[0].length
    var nc = Math.min(inp.length, out.length, 2)
    var ac = 1 - Math.exp(-1 / (atk * 0.001 * sampleRate))
    var rc = 1 - Math.exp(-1 / (rel * 0.001 * sampleRate))
    var L = inp[0]
    var R = inp[1] || inp[0]

    for (var i = 0; i < n; i++) {
      var pk = Math.abs(L[i])
      var pr = Math.abs(R[i])
      if (pr > pk) {
        pk = pr
      }
      var lvl = 20 * Math.log10(pk + 1e-10)
      var gr = lvl > thr ? (lvl - thr) * (1 - 1 / rat) : 0
      this.env += (gr - this.env) * (gr > this.env ? ac : rc)
      var g = Math.pow(10, (-this.env + mkup) / 20)
      for (var ch = 0; ch < nc; ch++) {
        out[ch][i] = (inp[ch] ? inp[ch][i] : L[i]) * g
      }
      for (var cc = nc; cc < out.length; cc++) {
        out[cc][i] = out[0][i]
      }
    }
    return true
  }
}
registerProcessor('cp-processor', CpProcessor)
`
