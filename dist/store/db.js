import { gen_id, is_rec, field, num_or, str_or } from '../types.js'
const DB_NAME = 'WaveForgeDB'
const DB_VER = 2
const ST_TRACKS = 'tracks'
const ST_AUDIO = 'audio'
const ST_PLAYLISTS = 'playlists'
const OPFS_DIR = 'tracks'
const OPFS_STEMS = 'stems'
const STEM_MAGIC = 0x5453524e
const STEM_VER = 1
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
function stems_meta_parse(v) {
  if (!is_rec(v)) {
    return null
  }
  const sources = str_list(field(v, 'sources'))
  const n = num_or(field(v, 'n'), 0)
  const len = num_or(field(v, 'len'), 0)
  if (!sources || n <= 0 || n > 8 || sources.length !== n || len <= 0) {
    return null
  }
  return { model: str_or(field(v, 'model'), ''), sources, n, len }
}
export function meta_parse(v) {
  if (!is_rec(v)) {
    return null
  }
  const id = field(v, 'id')
  const name = field(v, 'name')
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') {
    return null
  }
  const m = {
    id,
    name,
    duration: Math.max(0, num_or(field(v, 'duration'), 0)),
    sampleRate: num_or(field(v, 'sampleRate'), 44100),
    channels: num_or(field(v, 'channels'), 2),
    addedAt: num_or(field(v, 'addedAt'), 0),
    size: num_or(field(v, 'size'), 0),
  }
  const ab = field(v, 'abLoop')
  if (is_rec(ab)) {
    const s = field(ab, 'start')
    const e = field(ab, 'end')
    if (
      typeof s === 'number' &&
      typeof e === 'number' &&
      Number.isFinite(s) &&
      Number.isFinite(e) &&
      e > s
    ) {
      const loop = { start: s, end: e }
      m.abLoop = loop
    }
  }
  const opt_num = (k) => {
    const x = field(v, k)
    return typeof x === 'number' && Number.isFinite(x) ? x : undefined
  }
  const bpm = opt_num('bpm')
  if (bpm !== undefined && bpm > 0) {
    m.bpm = bpm
  }
  const beat = opt_num('beat')
  if (beat !== undefined) {
    m.beat = beat
  }
  const key = opt_num('key')
  if (key !== undefined && key >= 0 && key < 24) {
    m.key = Math.round(key)
  }
  const lufs = opt_num('lufs')
  if (lufs !== undefined) {
    m.lufs = lufs
  }
  const peak = opt_num('peak')
  if (peak !== undefined) {
    m.peak = peak
  }
  const pos = opt_num('pos')
  if (pos !== undefined && pos >= 0) {
    m.pos = pos
  }
  const mk = num_list(field(v, 'markers'))
  if (mk) {
    m.markers = mk.filter((x) => x >= 0).sort((a, b) => a - b)
  }
  const st = stems_meta_parse(field(v, 'stems'))
  if (st) {
    m.stems = st
  }
  return m
}
function playlist_parse(v) {
  if (!is_rec(v)) {
    return null
  }
  const id = field(v, 'id')
  const name = field(v, 'name')
  const ids = str_list(field(v, 'trackIds'))
  if (typeof id !== 'string' || typeof name !== 'string' || !ids) {
    return null
  }
  return { id, name, trackIds: ids, createdAt: num_or(field(v, 'createdAt'), 0) }
}
function idb_store(db, name, mode) {
  if (!db.idb) {
    return null
  }
  try {
    return db.idb.transaction(name, mode).objectStore(name)
  } catch {
    return null
  }
}
function idb_req(req) {
  if (!req) {
    return Promise.resolve(undefined)
  }
  return new Promise((resolve) => {
    req.onsuccess = () => {
      const r = req.result
      resolve(r)
    }
    req.onerror = () => resolve(undefined)
  })
}
function idb_put(db, store, value, key) {
  const st = idb_store(db, store, 'readwrite')
  if (!st) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    let req
    try {
      req = key !== undefined ? st.put(value, key) : st.put(value)
    } catch {
      resolve(false)
      return
    }
    req.onsuccess = () => resolve(true)
    req.onerror = () => resolve(false)
  })
}
function idb_del(db, store, key) {
  const st = idb_store(db, store, 'readwrite')
  if (!st) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const req = st.delete(key)
    req.onsuccess = () => resolve(true)
    req.onerror = () => resolve(false)
  })
}
function opfs_supported() {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in navigator.storage
  )
}
function opfs_writable_supported() {
  return (
    typeof FileSystemFileHandle !== 'undefined' &&
    typeof FileSystemFileHandle.prototype.createWritable === 'function'
  )
}
async function opfs_dir(db, name) {
  if (!db.opfs_root) {
    return null
  }
  try {
    return await db.opfs_root.getDirectoryHandle(name, { create: true })
  } catch {
    return null
  }
}
async function opfs_write(db, id, data) {
  const d = await opfs_dir(db, OPFS_DIR)
  if (!d) {
    return false
  }
  try {
    const fh = await d.getFileHandle(id + '.bin', { create: true })
    const w = await fh.createWritable()
    await w.write(data)
    await w.close()
    return true
  } catch {
    try {
      await d.removeEntry(id + '.bin')
    } catch {}
    return false
  }
}
async function opfs_read(db, id) {
  const d = await opfs_dir(db, OPFS_DIR)
  if (!d) {
    return null
  }
  try {
    const fh = await d.getFileHandle(id + '.bin')
    const f = await fh.getFile()
    const buf = await f.arrayBuffer()
    return buf.byteLength > 0 ? buf : null
  } catch {
    return null
  }
}
async function opfs_delete(db, dir, name) {
  const d = await opfs_dir(db, dir)
  if (!d) {
    return
  }
  try {
    await d.removeEntry(name)
  } catch {}
}
export async function db_open() {
  const db = {
    idb: null,
    opfs_root: null,
    use_opfs: opfs_supported() && opfs_writable_supported(),
    mode: 'memory',
    mem_tracks: new Map(),
    mem_audio: new Map(),
    mem_playlists: new Map(),
  }
  if (opfs_supported()) {
    try {
      db.opfs_root = await navigator.storage.getDirectory()
    } catch {
      db.use_opfs = false
    }
  }
  const opened = await new Promise((resolve) => {
    let req
    try {
      req = indexedDB.open(DB_NAME, DB_VER)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(ST_TRACKS)) {
        d.createObjectStore(ST_TRACKS, { keyPath: 'id' })
      }
      if (!d.objectStoreNames.contains(ST_AUDIO)) {
        d.createObjectStore(ST_AUDIO)
      }
      if (!d.objectStoreNames.contains(ST_PLAYLISTS)) {
        d.createObjectStore(ST_PLAYLISTS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  db.idb = opened
  db.mode = opened ? 'idb' : 'memory'
  if (opened) {
    opened.onversionchange = () => {
      opened.close()
      db.idb = null
      db.mode = 'memory'
    }
  }
  if ('storage' in navigator && 'persist' in navigator.storage) {
    navigator.storage.persist().catch(() => false)
  }
  return db
}
export async function db_has_legacy_audio(db) {
  if (!db.idb || !db.use_opfs) {
    return false
  }
  const st = idb_store(db, ST_AUDIO, 'readonly')
  if (!st) {
    return false
  }
  const n = await idb_req(st.count())
  return typeof n === 'number' && n > 0
}
export async function db_add_track(db, file, audio, meta) {
  const tm = {
    id: gen_id(),
    name: file.name.replace(/\.[^.]+$/, '') || file.name,
    duration: meta.duration,
    sampleRate: meta.sampleRate,
    channels: meta.channels,
    addedAt: Date.now(),
    size: audio.byteLength,
  }
  if (db.idb) {
    const meta_ok = await idb_put(db, ST_TRACKS, tm)
    if (!meta_ok) {
      return null
    }
    let audio_ok = false
    if (db.use_opfs) {
      audio_ok = await opfs_write(db, tm.id, audio)
    }
    if (!audio_ok) {
      audio_ok = await idb_put(db, ST_AUDIO, audio, tm.id)
    }
    if (!audio_ok) {
      await idb_del(db, ST_TRACKS, tm.id)
      return null
    }
    return tm
  }
  db.mem_tracks.set(tm.id, tm)
  db.mem_audio.set(tm.id, audio)
  return tm
}
export async function db_get_meta(db, id) {
  if (!db.idb) {
    return db.mem_tracks.get(id) ?? null
  }
  const st = idb_store(db, ST_TRACKS, 'readonly')
  if (!st) {
    return null
  }
  return meta_parse(await idb_req(st.get(id)))
}
export async function db_rename_track(db, id, name) {
  if (!db.idb) {
    const tm = db.mem_tracks.get(id)
    if (!tm) {
      return false
    }
    tm.name = name
    return true
  }
  const cur = await db_get_meta(db, id)
  if (!cur) {
    return false
  }
  cur.name = name
  return await idb_put(db, ST_TRACKS, cur)
}
export async function db_put_track_meta(db, meta) {
  if (!db.idb) {
    db.mem_tracks.set(meta.id, meta)
    return true
  }
  return await idb_put(db, ST_TRACKS, meta)
}
export async function db_get_audio(db, id) {
  if (!db.idb) {
    return db.mem_audio.get(id) ?? null
  }
  if (db.use_opfs) {
    const d = await opfs_read(db, id)
    if (d) {
      return d
    }
  }
  const st = idb_store(db, ST_AUDIO, 'readonly')
  if (!st) {
    return null
  }
  const r = await idb_req(st.get(id))
  return r instanceof ArrayBuffer ? r : null
}
export async function db_all_metas(db) {
  if (!db.idb) {
    return [...db.mem_tracks.values()]
  }
  const st = idb_store(db, ST_TRACKS, 'readonly')
  if (!st) {
    return []
  }
  const r = await idb_req(st.getAll())
  const out = []
  if (Array.isArray(r)) {
    for (const x of r) {
      const m = meta_parse(x)
      if (m) {
        out.push(m)
      }
    }
  }
  return out
}
export async function db_delete_track(db, id) {
  await db_stems_delete(db, id)
  if (!db.idb) {
    db.mem_tracks.delete(id)
    db.mem_audio.delete(id)
    return
  }
  await idb_del(db, ST_TRACKS, id)
  if (db.use_opfs) {
    await opfs_delete(db, OPFS_DIR, id + '.bin')
  }
  await idb_del(db, ST_AUDIO, id)
}
export async function db_delete_track_cascade(db, id) {
  await db_delete_track(db, id)
  const lists = await db_all_playlists(db)
  for (const pl of lists) {
    if (pl.trackIds.includes(id)) {
      pl.trackIds = pl.trackIds.filter((t) => t !== id)
      await db_update_playlist(db, pl)
    }
  }
}
export async function db_add_playlist(db, name) {
  const pl = { id: gen_id(), name, trackIds: [], createdAt: Date.now() }
  if (!db.idb) {
    db.mem_playlists.set(pl.id, pl)
    return pl
  }
  await idb_put(db, ST_PLAYLISTS, pl)
  return pl
}
export async function db_all_playlists(db) {
  if (!db.idb) {
    return [...db.mem_playlists.values()]
  }
  const st = idb_store(db, ST_PLAYLISTS, 'readonly')
  if (!st) {
    return []
  }
  const r = await idb_req(st.getAll())
  const out = []
  if (Array.isArray(r)) {
    for (const x of r) {
      const p = playlist_parse(x)
      if (p) {
        out.push(p)
      }
    }
  }
  return out
}
export async function db_update_playlist(db, pl) {
  if (!db.idb) {
    db.mem_playlists.set(pl.id, pl)
    return
  }
  await idb_put(db, ST_PLAYLISTS, pl)
}
export async function db_delete_playlist(db, id) {
  if (!db.idb) {
    db.mem_playlists.delete(id)
    return
  }
  await idb_del(db, ST_PLAYLISTS, id)
}
export async function db_stems_save(db, id, meta, data, scale) {
  const d = await opfs_dir(db, OPFS_STEMS)
  if (!d || !opfs_writable_supported()) {
    return false
  }
  const json = new TextEncoder().encode(JSON.stringify(meta))
  const jpad = (json.byteLength + 3) & ~3
  const n_blk = scale[0]?.length ?? 0
  const head = new ArrayBuffer(24 + jpad)
  const hv = new DataView(head)
  hv.setUint32(0, STEM_MAGIC, true)
  hv.setUint32(4, STEM_VER, true)
  hv.setUint32(8, meta.n, true)
  hv.setUint32(12, meta.len, true)
  hv.setUint32(16, n_blk, true)
  hv.setUint32(20, json.byteLength, true)
  new Uint8Array(head, 24).set(json)
  const name = id + '.bin'
  try {
    const fh = await d.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(head)
    for (const s of scale) {
      await w.write(s)
    }
    for (const x of data) {
      await w.write(x)
    }
    await w.close()
    return true
  } catch {
    await opfs_delete(db, OPFS_STEMS, name)
    return false
  }
}
export async function db_stems_load(db, id) {
  const d = await opfs_dir(db, OPFS_STEMS)
  if (!d) {
    return null
  }
  let buf
  try {
    const fh = await d.getFileHandle(id + '.bin')
    buf = await (await fh.getFile()).arrayBuffer()
  } catch {
    return null
  }
  if (buf.byteLength < 24) {
    return null
  }
  const hv = new DataView(buf)
  if (hv.getUint32(0, true) !== STEM_MAGIC || hv.getUint32(4, true) !== STEM_VER) {
    return null
  }
  const n = hv.getUint32(8, true)
  const len = hv.getUint32(12, true)
  const n_blk = hv.getUint32(16, true)
  const jlen = hv.getUint32(20, true)
  const jpad = (jlen + 3) & ~3
  const need = 24 + jpad + n * 2 * n_blk * 4 + n * 2 * len * 2
  if (n === 0 || n > 8 || buf.byteLength < need || n_blk < (len >> 10) + 1) {
    return null
  }
  let meta = null
  try {
    const j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 24, jlen)))
    meta = stems_meta_parse(j)
  } catch {
    meta = null
  }
  if (!meta || meta.n !== n || meta.len !== len) {
    return null
  }
  const scale = []
  const data = []
  let off = 24 + jpad
  for (let i = 0; i < n * 2; i++) {
    scale.push(new Float32Array(buf, off, n_blk))
    off += n_blk * 4
  }
  for (let i = 0; i < n * 2; i++) {
    data.push(new Int16Array(buf, off, len))
    off += len * 2
  }
  return { meta, data, scale, buffers: [buf] }
}
export async function db_stems_delete(db, id) {
  await opfs_delete(db, OPFS_STEMS, id + '.bin')
}
