function put_ascii(v, off, s) {
  for (let i = 0; i < s.length; i++) {
    v.setUint8(off + i, s.charCodeAt(i))
  }
}
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
export function wav_encode_planar(chans, sr, fmt) {
  const n_ch = chans.length
  const frames = chans[0]?.length ?? 0
  const bps = fmt === 32 ? 4 : fmt === 24 ? 3 : 2
  const block = n_ch * bps
  const data_size = frames * block
  const hdr = fmt === 32 ? 58 : 44
  const out = new ArrayBuffer(hdr + data_size)
  const v = new DataView(out)
  put_ascii(v, 0, 'RIFF')
  v.setUint32(4, hdr - 8 + data_size, true)
  put_ascii(v, 8, 'WAVE')
  put_ascii(v, 12, 'fmt ')
  if (fmt === 32) {
    v.setUint32(16, 18, true)
    v.setUint16(20, 3, true)
  } else {
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
  }
  v.setUint16(22, n_ch, true)
  v.setUint32(24, sr, true)
  v.setUint32(28, sr * block, true)
  v.setUint16(32, block, true)
  v.setUint16(34, bps * 8, true)
  let off = 36
  if (fmt === 32) {
    v.setUint16(36, 0, true)
    put_ascii(v, 38, 'fact')
    v.setUint32(42, 4, true)
    v.setUint32(46, frames, true)
    off = 50
  }
  put_ascii(v, off, 'data')
  v.setUint32(off + 4, data_size, true)
  const base = off + 8
  if (fmt === 32) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < n_ch; c++) {
        v.setFloat32(base + (i * n_ch + c) * 4, chans[c]?.[i] ?? 0, true)
      }
    }
    return out
  }
  if (fmt === 24) {
    const u8 = new Uint8Array(out)
    let p = base
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < n_ch; c++) {
        let s = chans[c]?.[i] ?? 0
        s = s < -1 ? -1 : s > 1 ? 1 : s
        let q = Math.round(s * 8388607)
        if (q < -8388608) {
          q = -8388608
        }
        u8[p] = q & 255
        u8[p + 1] = (q >> 8) & 255
        u8[p + 2] = (q >> 16) & 255
        p += 3
      }
    }
    return out
  }
  const pcm = LITTLE ? new Int16Array(out, base, frames * n_ch) : null
  let seed = 22222
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n_ch; c++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const r1 = seed / 4294967296
      seed = (seed * 1664525 + 1013904223) >>> 0
      const r2 = seed / 4294967296
      const s = (chans[c]?.[i] ?? 0) * 32767 + (r1 - r2)
      let q = Math.round(s)
      if (q > 32767) {
        q = 32767
      } else if (q < -32768) {
        q = -32768
      }
      if (pcm) {
        pcm[i * n_ch + c] = q
      } else {
        v.setInt16(base + (i * n_ch + c) * 2, q, true)
      }
    }
  }
  return out
}
export function wav_encode(buf, fmt) {
  const chans = []
  for (let c = 0; c < buf.numberOfChannels; c++) {
    chans.push(buf.getChannelData(c))
  }
  return wav_encode_planar(chans, buf.sampleRate, fmt)
}
export function file_download(data, filename, mime) {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
export function wav_download(buf, filename, fmt) {
  file_download(
    wav_encode(buf, fmt),
    filename.endsWith('.wav') ? filename : filename + '.wav',
    'audio/wav',
  )
}
