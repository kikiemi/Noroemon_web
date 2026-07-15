import { gen_id } from '../types.js'
const DB_NAME = 'WaveForgeDB'
const DB_VER = 2
const ST_TRACKS = 'tracks'
const ST_AUDIO = 'audio'
const ST_PLAYLISTS = 'playlists'
const OPFS_DIR = 'tracks'
function idb_store(db, name, mode) {
  if (!db.idb) {
    return null
  }
  return db.idb.transaction(name, mode).objectStore(name)
}
function idb_req(req) {
  if (!req) {
    return Promise.resolve(undefined)
  }
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(undefined)
  })
}
function idb_put(db, store, value, key) {
  const st = idb_store(db, store, 'readwrite')
  if (!st) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const req = key !== undefined ? st.put(value, key) : st.put(value)
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
async function opfs_dir(db) {
  if (!db.opfs_root) {
    return null
  }
  try {
    return await db.opfs_root.getDirectoryHandle(OPFS_DIR, { create: true })
  } catch {
    return null
  }
}
async function opfs_write(db, id, data) {
  const d = await opfs_dir(db)
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
  const d = await opfs_dir(db)
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
async function opfs_delete(db, id) {
  const d = await opfs_dir(db)
  if (!d) {
    return
  }
  try {
    await d.removeEntry(id + '.bin')
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
  if (db.use_opfs) {
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
  return (n ?? 0) > 0
}
export async function db_add_track(db, file, audio, meta) {
  const tm = {
    id: gen_id(),
    name: file.name.replace(/\.[^.]+$/, ''),
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
  const r = await idb_req(st.get(id))
  return r ?? null
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
  return r ?? null
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
  return r ?? []
}
export async function db_delete_track(db, id) {
  if (!db.idb) {
    db.mem_tracks.delete(id)
    db.mem_audio.delete(id)
    return
  }
  await idb_del(db, ST_TRACKS, id)
  if (db.use_opfs) {
    await opfs_delete(db, id)
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
  return r ?? []
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
