function put_ascii(v, off, s) {
  for (let i = 0; i < s.length; i++) {
    v.setUint8(off + i, s.charCodeAt(i))
  }
}
export function wav_encode(buf) {
  const n_ch = buf.numberOfChannels
  const sr = buf.sampleRate
  const frames = buf.length
  const block = n_ch * 2
  const data_size = frames * block
  const out = new ArrayBuffer(44 + data_size)
  const v = new DataView(out)
  put_ascii(v, 0, 'RIFF')
  v.setUint32(4, 36 + data_size, true)
  put_ascii(v, 8, 'WAVE')
  put_ascii(v, 12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, n_ch, true)
  v.setUint32(24, sr, true)
  v.setUint32(28, sr * block, true)
  v.setUint16(32, block, true)
  v.setUint16(34, 16, true)
  put_ascii(v, 36, 'data')
  v.setUint32(40, data_size, true)
  const chans = []
  for (let c = 0; c < n_ch; c++) {
    chans.push(buf.getChannelData(c))
  }
  let off = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < n_ch; c++) {
      let s = chans[c][i]
      if (s < -1) {
        s = -1
      } else if (s > 1) {
        s = 1
      }
      v.setInt16(off, s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0, true)
      off += 2
    }
  }
  return out
}
export function wav_download(buf, filename) {
  const blob = new Blob([wav_encode(buf)], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.wav') ? filename : filename + '.wav'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
