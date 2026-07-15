export const BPM_WORKER_CODE = `
'use strict'

function fftc(re, im, n) {
  var i, j, m, t
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
    var a = -Math.PI / h
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
}

self.onmessage = function (e) {
  var src = e.data.channel
  var sr0 = e.data.sampleRate

  var DEC = 4
  var want = Math.min(src.length, (sr0 * 60) | 0)
  var start = ((src.length - want) * 0.25) | 0
  var sr = sr0 / DEC
  var n_samp = (want / DEC) | 0
  var ch = new Float32Array(n_samp)
  for (var i = 0; i < n_samp; i++) {
    var b = start + i * DEC

    ch[i] = (src[b] + src[b + 1] + src[b + 2] + src[b + 3]) * 0.25
  }

  var FS = 1024,
    HP = 256
  var nf = ((n_samp - FS) / HP) | 0
  if (nf < 8) {
    self.postMessage({ type: 'bpm', value: 0 })
    return
  }

  var re = new Float32Array(FS)
  var im = new Float32Array(FS)
  var prev = new Float32Array((FS >> 1) + 1)
  var flux = new Float32Array(nf)
  var win = new Float32Array(FS)
  for (var w = 0; w < FS; w++) {
    win[w] = 0.5 * (1 - Math.cos((2 * Math.PI * w) / FS))
  }

  for (var f = 0; f < nf; f++) {
    var off = f * HP
    for (var s = 0; s < FS; s++) {
      re[s] = ch[off + s] * win[s]
      im[s] = 0
    }
    fftc(re, im, FS)
    var sf = 0
    for (var k = 0; k <= FS >> 1; k++) {
      var mg = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      var df = mg - prev[k]
      if (df > 0) {
        sf += df
      }
      prev[k] = mg
    }
    flux[f] = sf
  }

  var min_lag = Math.floor((60 * sr) / (HP * 200))
  var max_lag = Math.ceil((60 * sr) / (HP * 60))
  if (max_lag >= nf) {
    max_lag = nf - 1
  }

  var score = new Float32Array(max_lag + 1)
  var best = 0,
    best_lag = min_lag
  for (var lag = min_lag; lag <= max_lag; lag++) {
    var sum = 0
    for (var t2 = 0; t2 < nf - lag; t2++) {
      sum += flux[t2] * flux[t2 + lag]
    }
    sum /= nf - lag
    score[lag] = sum
    if (sum > best) {
      best = sum
      best_lag = lag
    }
  }

  var dbl = best_lag * 2
  if (dbl <= max_lag && score[dbl] >= best * 0.9) {
    best_lag = dbl
  }

  var refined = best_lag
  if (best_lag > min_lag && best_lag < max_lag) {
    var y0 = score[best_lag - 1],
      y1 = score[best_lag],
      y2 = score[best_lag + 1]
    var d = y0 - 2 * y1 + y2
    if (d !== 0) {
      refined = best_lag - (y2 - y0) / (2 * d)
    }
  }

  var bpm = (60 * sr) / (refined * HP)
  self.postMessage({ type: 'bpm', value: Math.round(bpm * 10) / 10 })
}
`
