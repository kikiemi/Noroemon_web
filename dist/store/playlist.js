import { PLAY_SEQ, PLAY_SHUFFLE, PLAY_REPEAT1, PLAY_REPEATALL } from '../types.js'
import { db_all_playlists, db_add_playlist, db_update_playlist, db_delete_playlist } from './db.js'
export function pl_new(db) {
  return {
    db,
    lists: new Map(),
    cur_id: null,
    cur_idx: 0,
    shuffle_order: [],
    shuffle_idx: 0,
    play_mode: PLAY_SEQ,
  }
}
export async function pl_load(p) {
  const lists = await db_all_playlists(p.db)
  p.lists.clear()
  for (const l of lists) {
    p.lists.set(l.id, l)
  }
  if (p.lists.size === 0) {
    await pl_create(p, 'デフォルト')
  }
}
export async function pl_create(p, name) {
  const pl = await db_add_playlist(p.db, name)
  p.lists.set(pl.id, pl)
  if (!p.cur_id) {
    p.cur_id = pl.id
  }
  return pl
}
export async function pl_delete(p, id) {
  p.lists.delete(id)
  await db_delete_playlist(p.db, id)
  if (p.cur_id === id) {
    const first = p.lists.keys().next()
    p.cur_id = first.done ? null : first.value
    p.cur_idx = 0
    pl_reshuffle(p)
  }
}
export async function pl_rename(p, id, name) {
  const pl = p.lists.get(id)
  if (!pl) {
    return
  }
  pl.name = name
  await db_update_playlist(p.db, pl)
}
export function pl_all(p) {
  return [...p.lists.values()]
}
export function pl_current(p) {
  return p.cur_id ? (p.lists.get(p.cur_id) ?? null) : null
}
export function pl_set_current(p, id) {
  if (p.lists.has(id)) {
    p.cur_id = id
    p.cur_idx = 0
    pl_reshuffle(p)
  }
}
export async function pl_add_track(p, playlist_id, track_id) {
  const pl = p.lists.get(playlist_id)
  if (!pl) {
    return
  }
  if (!pl.trackIds.includes(track_id)) {
    pl.trackIds.push(track_id)
    await db_update_playlist(p.db, pl)
    pl_reshuffle(p)
  }
}
export async function pl_remove_track(p, playlist_id, track_id) {
  const pl = p.lists.get(playlist_id)
  if (!pl) {
    return
  }
  pl.trackIds = pl.trackIds.filter((t) => t !== track_id)
  await db_update_playlist(p.db, pl)
  if (p.cur_idx >= pl.trackIds.length) {
    p.cur_idx = pl.trackIds.length > 0 ? pl.trackIds.length - 1 : 0
  }
  pl_reshuffle(p)
}
export function pl_set_current_track(p, track_id) {
  const pl = pl_current(p)
  if (!pl) {
    return
  }
  const i = pl.trackIds.indexOf(track_id)
  if (i >= 0) {
    p.cur_idx = i
    const si = p.shuffle_order.indexOf(i)
    if (si >= 0) {
      p.shuffle_idx = si
    }
  }
}
export function pl_set_index(p, i) {
  p.cur_idx = i
}
export function pl_next_id(p) {
  const pl = pl_current(p)
  if (!pl || pl.trackIds.length === 0) {
    return null
  }
  const n = pl.trackIds.length
  switch (p.play_mode) {
    case PLAY_SEQ: {
      if (p.cur_idx + 1 >= n) {
        return null
      }
      p.cur_idx++
      return pl.trackIds[p.cur_idx] ?? null
    }
    case PLAY_REPEATALL: {
      p.cur_idx = (p.cur_idx + 1) % n
      return pl.trackIds[p.cur_idx] ?? null
    }
    case PLAY_REPEAT1: {
      return pl.trackIds[p.cur_idx] ?? null
    }
    case PLAY_SHUFFLE: {
      p.shuffle_idx++
      if (p.shuffle_idx >= p.shuffle_order.length) {
        pl_reshuffle(p)
      }
      p.cur_idx = p.shuffle_order[p.shuffle_idx] ?? 0
      return pl.trackIds[p.cur_idx] ?? null
    }
  }
}
export function pl_prev_id(p) {
  const pl = pl_current(p)
  if (!pl || pl.trackIds.length === 0) {
    return null
  }
  if (p.play_mode === PLAY_SHUFFLE) {
    if (p.shuffle_idx > 0) {
      p.shuffle_idx--
    }
    p.cur_idx = p.shuffle_order[p.shuffle_idx] ?? 0
    return pl.trackIds[p.cur_idx] ?? null
  }
  if (p.cur_idx > 0) {
    p.cur_idx--
  }
  return pl.trackIds[p.cur_idx] ?? null
}
export function pl_reshuffle(p) {
  const pl = pl_current(p)
  if (!pl) {
    p.shuffle_order = []
    p.shuffle_idx = 0
    return
  }
  p.shuffle_order = pl.trackIds.map((_, i) => i)
  for (let i = p.shuffle_order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0
    const t = p.shuffle_order[i]
    p.shuffle_order[i] = p.shuffle_order[j]
    p.shuffle_order[j] = t
  }
  p.shuffle_idx = 0
}
