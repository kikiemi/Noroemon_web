import {
  eng_init,
  eng_decode,
  eng_load_buffer,
  eng_play,
  eng_pause,
  eng_stop,
  eng_seek,
  eng_set_pitch,
  eng_set_tempo,
  eng_set_volume,
  eng_set_loop,
  eng_clear_loop,
  eng_reverse,
  eng_set_eq_band,
  eng_set_eq_all,
  eng_set_reverb,
  eng_set_bitcrusher,
  eng_set_vocal_cancel,
  eng_set_formant,
  eng_set_modulation,
  eng_set_compressor,
  eng_detect_pitch,
  eng_detect_bpm,
  eng_start_mic,
  eng_stop_mic,
  eng_mic_active,
  eng_render_offline,
  eng_on,
} from '../engine.js'
import {
  db_open,
  db_add_track,
  db_get_meta,
  db_get_audio,
  db_all_metas,
  db_delete_track_cascade,
  db_update_playlist,
  db_put_track_meta,
  db_has_legacy_audio,
  db_rename_track,
} from '../store/db.js'
import {
  pl_new,
  pl_load,
  pl_create,
  pl_delete,
  pl_rename,
  pl_all,
  pl_current,
  pl_set_current,
  pl_add_track,
  pl_reorder,
  pl_forget_track,
  pl_prune,
  pl_set_current_track,
  pl_next_id,
  pl_prev_id,
} from '../store/playlist.js'
import { knob_set, slider_set, eq_bank_set } from './widgets.js'
import {
  wf_set_buffer,
  wf_set_pos,
  wf_set_loop,
  wf_clear_loop,
  wf_set_mirrored,
} from './waveform.js'
import { vz_connect, vz_set_playing, vz_set_mode } from './visualizer.js'
import { theme_apply } from './theme.js'
import { wav_download } from '../dsp/wav.js'
import { doc_hidden, on_visibility } from './dom.js'
import {
  refs_init,
  view_controls_new,
  view_wire,
  view_toast,
  view_confirm,
  view_prompt,
  view_pick_files,
  view_play_btn,
  view_play_enabled,
  view_loop_btn,
  view_play_mode_btn,
  view_toggles,
  view_toggle,
  view_track_name,
  view_time_current,
  view_time_total,
  view_position,
  view_bpm,
  view_pitch_chip,
  view_export_busy,
  view_set_view,
  view_playlist_render,
  view_playlist_highlight,
  view_settings_toggle,
} from './view.js'
import {
  default_state,
  default_settings,
  clamp,
  EQ_PRESETS,
  LOOP_NONE,
  LOOP_SINGLE,
  LOOP_AB,
  LOOP_ALL,
  PLAY_SEQ,
  PLAY_SHUFFLE,
  PLAY_REPEAT1,
  PLAY_REPEATALL,
  MOD_FLANGER,
  MOD_CHORUS,
  MOD_PHASER,
  VIZ_WAVE,
  VIZ_BARS,
  THEME_AUTO,
  THEME_LIGHT,
  THEME_DARK,
  PITCH_MIN,
  PITCH_MAX,
  EQ_BANDS,
} from '../types.js'
function num_or(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}
function bool_or(v, d) {
  return typeof v === 'boolean' ? v : d
}
function save_state(app) {
  try {
    localStorage.setItem('wf-state', JSON.stringify(app.st))
  } catch {}
}
function save_settings(app) {
  try {
    localStorage.setItem('wf-settings', JSON.stringify(app.settings))
  } catch {}
}
function load_persisted() {
  const d = default_state()
  try {
    const raw = localStorage.getItem('wf-state')
    if (raw) {
      const r = JSON.parse(raw)
      d.currentTrackId = typeof r.currentTrackId === 'string' ? r.currentTrackId : null
      d.currentPlaylistId = typeof r.currentPlaylistId === 'string' ? r.currentPlaylistId : null
      d.volume = clamp(num_or(r.volume, d.volume), 0, 1)
      d.pitch = clamp(num_or(r.pitch, d.pitch), PITCH_MIN, PITCH_MAX)
      d.tempo = clamp(num_or(r.tempo, d.tempo), 0.25, 4)
      if (Array.isArray(r.eqGains) && r.eqGains.length === EQ_BANDS.length) {
        d.eqGains = r.eqGains.map((g) => clamp(num_or(g, 0), -12, 12))
      }
      const lm = r.loopMode
      d.loopMode = lm === LOOP_SINGLE || lm === LOOP_AB || lm === LOOP_ALL ? lm : LOOP_NONE
      d.loopStart = Math.max(0, num_or(r.loopStart, 0))
      d.loopEnd = Math.max(0, num_or(r.loopEnd, 0))
      const pm = r.playMode
      d.playMode =
        pm === PLAY_SHUFFLE || pm === PLAY_REPEAT1 || pm === PLAY_REPEATALL ? pm : PLAY_SEQ
      d.reverb = clamp(num_or(r.reverb, 0), 0, 1)
      d.bitcrusherBits = clamp(num_or(r.bitcrusherBits, 16), 1, 16)
      d.bitcrusherReduction = clamp(num_or(r.bitcrusherReduction, 1), 1, 32)
      d.bitcrusherEnabled = bool_or(r.bitcrusherEnabled, false)
      d.vocalCancel = bool_or(r.vocalCancel, false)
      d.reverse = bool_or(r.reverse, false)
      d.formant = bool_or(r.formant, d.formant)
      d.bpm = Math.max(0, num_or(r.bpm, 0))
      const rm = r.mod
      if (rm && typeof rm === 'object') {
        const mm = rm.mode
        d.mod.mode = mm === MOD_CHORUS || mm === MOD_PHASER ? mm : MOD_FLANGER
        d.mod.rate = clamp(num_or(rm.rate, d.mod.rate), 0.01, 10)
        d.mod.depth = clamp(num_or(rm.depth, d.mod.depth), 0, 1)
        d.mod.fb = clamp(num_or(rm.fb, d.mod.fb), -0.95, 0.95)
        d.mod.mix = clamp(num_or(rm.mix, d.mod.mix), 0, 1)
        d.mod.en = bool_or(rm.en, false)
      }
      const rc = r.comp
      if (rc && typeof rc === 'object') {
        d.comp.thr = clamp(num_or(rc.thr, d.comp.thr), -60, 0)
        d.comp.rat = clamp(num_or(rc.rat, d.comp.rat), 1, 20)
        d.comp.atk = clamp(num_or(rc.atk, d.comp.atk), 0.1, 200)
        d.comp.rel = clamp(num_or(rc.rel, d.comp.rel), 10, 2000)
        d.comp.mkup = clamp(num_or(rc.mkup, d.comp.mkup), 0, 40)
        d.comp.en = bool_or(rc.en, false)
      }
    }
  } catch {}
  const s = default_settings()
  try {
    const raw = localStorage.getItem('wf-settings')
    if (raw) {
      const r = JSON.parse(raw)
      s.formantDef = bool_or(r.formantDef, s.formantDef)
      s.bpmAuto = bool_or(r.bpmAuto, s.bpmAuto)
      s.vizMode = r.vizMode === VIZ_WAVE ? VIZ_WAVE : VIZ_BARS
      const th = r.theme
      s.theme = th === THEME_LIGHT || th === THEME_DARK ? th : THEME_AUTO
    }
  } catch {}
  if (!localStorage.getItem('wf-state')) {
    d.formant = s.formantDef
  }
  return { st: d, settings: s }
}
function apply_state_to_engine(app) {
  eng_set_pitch(app.eng, app.st.pitch)
  eng_set_tempo(app.eng, app.st.tempo)
  eng_set_volume(app.eng, app.st.volume)
  eng_set_eq_all(app.eng, app.st.eqGains)
  eng_set_reverb(app.eng, app.st.reverb)
  eng_set_bitcrusher(
    app.eng,
    app.st.bitcrusherBits,
    app.st.bitcrusherReduction,
    app.st.bitcrusherEnabled,
  )
  eng_set_vocal_cancel(app.eng, app.st.vocalCancel)
  eng_set_formant(app.eng, app.st.formant, app.st.pitch)
  eng_set_modulation(app.eng, app.st.mod)
  eng_set_compressor(app.eng, app.st.comp)
}
function bind_widget_handlers(app) {
  const ui = app.ui
  const eng = app.eng
  ui.k_pitch.on_change = (v) => {
    app.st.pitch = v
    eng_set_pitch(eng, v)
    eng_set_formant(eng, app.st.formant, v)
    save_state(app)
  }
  ui.k_tempo.on_change = (v) => {
    app.st.tempo = v / 100
    eng_set_tempo(eng, app.st.tempo)
    save_state(app)
  }
  ui.k_vol.on_change = (v) => {
    app.st.volume = v / 100
    eng_set_volume(eng, app.st.volume)
    save_state(app)
  }
  ui.wf.on_seek = (t) => {
    if (eng.duration > 0) {
      eng_seek(eng, t * eng.duration)
    }
  }
  ui.wf.on_loop = (s, en) => {
    app.st.loopStart = s
    app.st.loopEnd = en
    app.st.loopMode = LOOP_AB
    eng_set_loop(eng, s, en)
    view_loop_btn(app.refs, app.st.loopMode)
    save_state(app)
    if (app.cur_meta) {
      void persist_track_loop(app, app.cur_meta, { start: s, end: en })
    }
  }
  ui.eq.on_change = (i, v) => {
    app.st.eqGains[i] = v
    eng_set_eq_band(eng, i, v)
    save_state(app)
  }
  ui.s_reverb.on_change = (v) => {
    app.st.reverb = v / 100
    eng_set_reverb(eng, app.st.reverb)
    save_state(app)
  }
  ui.s_bits.on_change = (v) => {
    app.st.bitcrusherBits = v
    eng_set_bitcrusher(eng, v, app.st.bitcrusherReduction, app.st.bitcrusherEnabled)
    save_state(app)
  }
  ui.s_red.on_change = (v) => {
    app.st.bitcrusherReduction = v
    eng_set_bitcrusher(eng, app.st.bitcrusherBits, v, app.st.bitcrusherEnabled)
    save_state(app)
  }
  ui.k_mrate.on_change = (v) => {
    app.st.mod.rate = v
    eng_set_modulation(eng, app.st.mod)
    save_state(app)
  }
  ui.k_mdepth.on_change = (v) => {
    app.st.mod.depth = v
    eng_set_modulation(eng, app.st.mod)
    save_state(app)
  }
  ui.k_mfb.on_change = (v) => {
    app.st.mod.fb = v
    eng_set_modulation(eng, app.st.mod)
    save_state(app)
  }
  ui.k_mmix.on_change = (v) => {
    app.st.mod.mix = v
    eng_set_modulation(eng, app.st.mod)
    save_state(app)
  }
  ui.s_cthr.on_change = (v) => {
    app.st.comp.thr = v
    eng_set_compressor(eng, app.st.comp)
    save_state(app)
  }
  ui.s_crat.on_change = (v) => {
    app.st.comp.rat = v
    eng_set_compressor(eng, app.st.comp)
    save_state(app)
  }
  ui.s_catk.on_change = (v) => {
    app.st.comp.atk = v
    eng_set_compressor(eng, app.st.comp)
    save_state(app)
  }
  ui.s_crel.on_change = (v) => {
    app.st.comp.rel = v
    eng_set_compressor(eng, app.st.comp)
    save_state(app)
  }
  ui.s_cmk.on_change = (v) => {
    app.st.comp.mkup = v
    eng_set_compressor(eng, app.st.comp)
    save_state(app)
  }
}
function sync_widgets(app) {
  const ui = app.ui
  const st = app.st
  knob_set(ui.k_pitch, st.pitch, false)
  knob_set(ui.k_tempo, st.tempo * 100, false)
  knob_set(ui.k_vol, st.volume * 100, false)
  slider_set(ui.s_reverb, st.reverb * 100, false)
  slider_set(ui.s_bits, st.bitcrusherBits, false)
  slider_set(ui.s_red, st.bitcrusherReduction, false)
  eq_bank_set(ui.eq, st.eqGains)
  knob_set(ui.k_mrate, st.mod.rate, false)
  knob_set(ui.k_mdepth, st.mod.depth, false)
  knob_set(ui.k_mfb, st.mod.fb, false)
  knob_set(ui.k_mmix, st.mod.mix, false)
  slider_set(ui.s_cthr, st.comp.thr, false)
  slider_set(ui.s_crat, st.comp.rat, false)
  slider_set(ui.s_catk, st.comp.atk, false)
  slider_set(ui.s_crel, st.comp.rel, false)
  slider_set(ui.s_cmk, st.comp.mkup, false)
}
function render_playlist(app) {
  const cur = pl_current(app.pl)
  if (!cur) {
    view_playlist_render(app.refs, [], [], null, playlist_handlers(app))
    return
  }
  const all = pl_all(app.pl)
  const tabs = all.map((p) => ({
    id: p.id,
    name: p.name,
    active: p.id === cur.id,
    deletable: p.id === cur.id && all.length > 1,
  }))
  const tracks = cur.trackIds
    .filter((tid) => app.metas.has(tid))
    .map((tid) => {
      const m = app.metas.get(tid)
      return { id: tid, name: m.name, duration: m.duration }
    })
  view_playlist_render(
    app.refs,
    tabs,
    tracks,
    app.cur_meta ? app.cur_meta.id : null,
    playlist_handlers(app),
  )
}
function playlist_handlers(app) {
  return {
    on_tab_select: (id) => {
      pl_set_current(app.pl, id)
      app.st.currentPlaylistId = id
      save_state(app)
      render_playlist(app)
    },
    on_tab_rename: (id) => {
      const p = pl_all(app.pl).find((x) => x.id === id)
      if (!p) {
        return
      }
      const input = view_prompt('プレイリスト名', p.name)
      if (input === null) {
        return
      }
      const name = input.trim()
      if (name === '' || name === p.name) {
        return
      }
      void pl_rename(app.pl, id, name).then(() => render_playlist(app))
    },
    on_tab_delete: (id) => {
      const p = pl_all(app.pl).find((x) => x.id === id)
      if (!p) {
        return
      }
      if (
        !view_confirm('「' + p.name + '」を削除しますか？\n（曲そのものはライブラリに残ります）')
      ) {
        return
      }
      void pl_delete(app.pl, id).then(() => {
        const now = pl_current(app.pl)
        app.st.currentPlaylistId = now ? now.id : null
        save_state(app)
        render_playlist(app)
      })
    },
    on_track_select: (tid) => {
      void load_track(app, tid, true)
      if (app.view === 'playlist') {
        set_view(app, 'player')
      }
    },
    on_track_rename: (tid) => {
      void rename_track(app, tid)
    },
    on_track_delete: (tid) => {
      const meta = app.metas.get(tid)
      if (meta) {
        void delete_track(app, tid, meta.name)
      }
    },
    on_track_reorder: (ids) => {
      const cur = pl_current(app.pl)
      if (!cur) {
        return
      }
      void pl_reorder(app.pl, cur.id, ids)
    },
  }
}
function ab_active_range(meta, reversed) {
  const stored = meta.abLoop
  if (!stored) {
    return null
  }
  const dur = meta.duration
  const s = clamp(stored.start, 0, dur)
  const en = clamp(stored.end, 0, dur)
  if (en - s < 0.05) {
    return null
  }
  if (!reversed) {
    return { start: s, end: en }
  }
  return { start: dur - en, end: dur - s }
}
async function persist_track_loop(app, meta, active) {
  if (active === null) {
    delete meta.abLoop
  } else if (app.st.reverse) {
    meta.abLoop = { start: meta.duration - active.end, end: meta.duration - active.start }
  } else {
    meta.abLoop = { start: active.start, end: active.end }
  }
  const ok = await db_put_track_meta(app.db, meta)
  if (!ok) {
    view_toast('ループ設定を保存できませんでした', true)
  }
}
function apply_track_loop(app, meta) {
  const ab = app.st.loopMode === LOOP_AB ? ab_active_range(meta, app.st.reverse) : null
  if (ab) {
    app.st.loopStart = ab.start
    app.st.loopEnd = ab.end
    eng_set_loop(app.eng, ab.start, ab.end)
    wf_set_loop(app.ui.wf, ab.start, ab.end)
    return
  }
  app.st.loopStart = 0
  app.st.loopEnd = 0
  if (app.st.loopMode === LOOP_SINGLE) {
    eng_set_loop(app.eng, 0, meta.duration)
  } else {
    eng_clear_loop(app.eng)
  }
  wf_clear_loop(app.ui.wf)
}
async function rename_track(app, tid) {
  const meta = app.metas.get(tid)
  if (!meta) {
    return
  }
  const input = view_prompt('曲名', meta.name)
  if (input === null) {
    return
  }
  const name = input.trim()
  if (name === '' || name === meta.name) {
    return
  }
  const ok = await db_rename_track(app.db, tid, name)
  if (!ok) {
    view_toast('名前の変更に失敗しました', true)
    return
  }
  meta.name = name
  if (app.cur_meta && app.cur_meta.id === tid) {
    app.cur_meta.name = name
    view_track_name(app.refs, name, true)
    ms_update_metadata(meta)
  }
  render_playlist(app)
  view_toast('名前を変更しました', false)
}
async function delete_track(app, tid, name) {
  if (
    !view_confirm(
      '「' +
        name +
        '」をライブラリから完全に削除しますか？\n（すべてのプレイリストから削除されます）',
    )
  ) {
    return
  }
  await db_delete_track_cascade(app.db, tid)
  pl_forget_track(app.pl, tid)
  app.metas.delete(tid)
  if (app.cur_meta && app.cur_meta.id === tid) {
    eng_stop(app.eng)
    app.cur_meta = null
    app.cur_audio = null
    app.playing = false
    view_play_btn(app.refs, false)
    view_track_name(app.refs, '曲を選んでください', false)
  }
  render_playlist(app)
}
async function import_file(app, file) {
  let buf
  try {
    buf = await file.arrayBuffer()
  } catch {
    view_toast('「' + file.name + '」の読み取りに失敗しました', true)
    return null
  }
  try {
    const decoded = await eng_decode(app.eng, buf.slice(0))
    let cur = pl_current(app.pl)
    if (!cur) {
      cur = await pl_create(app.pl, 'デフォルト')
    }
    const meta = await db_add_track(app.db, file, buf, {
      duration: decoded.duration,
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
    })
    if (!meta) {
      view_toast('ストレージ容量不足です。不要なトラックを削除してください。', true)
      return null
    }
    app.metas.set(meta.id, meta)
    await pl_add_track(app.pl, cur.id, meta.id)
    return meta.id
  } catch {
    view_toast('「' + file.name + '」は対応していない形式です', true)
    return null
  }
}
const PICK_ACCEPT =
  'audio/*,.mp3,.m4a,.m4b,.aac,.wav,.wave,.aif,.aiff,.aifc,.caf,.flac,.ogg,.oga,.opus,.weba,.webm'
function open_file_picker(app) {
  view_pick_files(PICK_ACCEPT, (files) => {
    void (async () => {
      let ok = 0
      let last_id = null
      for (const f of files) {
        const id = await import_file(app, f)
        if (id) {
          ok++
          last_id = id
        }
      }
      if (ok > 0) {
        view_toast(String(ok) + '曲を追加しました', false)
        render_playlist(app)
        if (!app.cur_meta && last_id) {
          await load_track(app, last_id, true)
        }
      }
    })()
  })
}
async function load_track(app, id, autoplay) {
  app.loading_id = id
  view_track_name(app.refs, '⏳ 読み込み中...', false)
  view_play_enabled(app.refs, false)
  try {
    const meta = await db_get_meta(app.db, id)
    const audio = await db_get_audio(app.db, id)
    if (app.loading_id !== id) {
      return
    }
    if (!meta || !audio) {
      view_track_name(app.refs, '⚠️ 読み込み失敗', false)
      view_toast('「' + (meta ? meta.name : '曲') + '」のデータを読み込めませんでした', true)
      return
    }
    app.cur_meta = meta
    app.cur_audio = audio
    app.st.currentTrackId = id
    pl_set_current_track(app.pl, id)
    const decoded = await eng_decode(app.eng, audio.slice(0))
    if (app.loading_id !== id) {
      return
    }
    await eng_load_buffer(app.eng, decoded)
    if (app.loading_id !== id) {
      return
    }
    apply_state_to_engine(app)
    wf_set_buffer(app.ui.wf, decoded)
    const cached_bpm = meta.bpm ?? 0
    app.st.bpm = cached_bpm
    view_bpm(app.refs, cached_bpm)
    if (app.settings.bpmAuto && cached_bpm <= 0) {
      app.bpm_track_id = id
      eng_detect_bpm(app.eng, decoded.getChannelData(0).slice(), decoded.sampleRate)
    } else {
      app.bpm_track_id = null
    }
    wf_set_mirrored(app.ui.wf, app.st.reverse)
    if (app.st.reverse) {
      eng_reverse(app.eng)
    }
    apply_track_loop(app, meta)
    view_track_name(app.refs, meta.name, true)
    view_time_total(app.refs, meta.duration)
    app.last_pos = 0
    view_playlist_highlight(app.refs, meta.id)
    save_state(app)
    ms_update_metadata(meta)
    if (autoplay) {
      app.playing = true
      eng_play(app.eng)
      vz_set_playing(app.ui.vz, true)
      view_play_btn(app.refs, true)
    }
  } catch {
    view_track_name(app.refs, '⚠️ 読み込み失敗', false)
  } finally {
    if (app.loading_id === id) {
      app.loading_id = null
    }
    view_play_enabled(app.refs, true)
  }
}
function play_toggle(app) {
  if (!app.cur_meta) {
    return
  }
  if (app.playing) {
    eng_pause(app.eng)
    app.playing = false
  } else {
    eng_play(app.eng)
    app.playing = true
  }
  vz_set_playing(app.ui.vz, app.playing)
  view_play_btn(app.refs, app.playing)
}
function do_stop(app) {
  eng_stop(app.eng)
  app.playing = false
  app.last_pos = 0
  vz_set_playing(app.ui.vz, false)
  view_play_btn(app.refs, false)
  view_time_current(app.refs, 0)
  wf_set_pos(app.ui.wf, 0)
}
function do_next(app) {
  const id = pl_next_id(app.pl)
  if (id) {
    void load_track(app, id, true)
  }
}
function do_prev(app) {
  const id = pl_prev_id(app.pl)
  if (id) {
    void load_track(app, id, true)
  }
}
function handle_ended(app) {
  if (app.st.loopMode === LOOP_SINGLE) {
    eng_seek(app.eng, 0)
    eng_play(app.eng)
    return
  }
  if (app.st.loopMode === LOOP_AB && app.st.loopEnd > app.st.loopStart) {
    eng_seek(app.eng, app.st.loopStart)
    eng_play(app.eng)
    return
  }
  if (app.st.playMode === PLAY_REPEAT1) {
    eng_seek(app.eng, 0)
    eng_play(app.eng)
    return
  }
  const next = pl_next_id(app.pl)
  if (next) {
    void load_track(app, next, true)
    return
  }
  if (app.st.playMode === PLAY_REPEATALL || app.st.loopMode === LOOP_ALL) {
    const cur = pl_current(app.pl)
    const first = cur ? cur.trackIds.find((tid) => app.metas.has(tid)) : undefined
    if (first) {
      void load_track(app, first, true)
      return
    }
  }
  app.playing = false
  vz_set_playing(app.ui.vz, false)
  view_play_btn(app.refs, false)
}
function cycle_loop_mode(app) {
  const order = [LOOP_NONE, LOOP_SINGLE, LOOP_AB, LOOP_ALL]
  const i = order.indexOf(app.st.loopMode)
  app.st.loopMode = order[(i + 1) % order.length] ?? LOOP_NONE
  if (app.cur_meta) {
    apply_track_loop(app, app.cur_meta)
  } else {
    app.st.loopStart = 0
    app.st.loopEnd = 0
    eng_clear_loop(app.eng)
    wf_clear_loop(app.ui.wf)
  }
  if (app.st.loopMode === LOOP_AB && !(app.st.loopEnd > app.st.loopStart)) {
    view_toast('波形をドラッグしてA-B区間を指定してください', false)
  }
  view_loop_btn(app.refs, app.st.loopMode)
  save_state(app)
}
function cycle_play_mode(app) {
  const order = [PLAY_SEQ, PLAY_SHUFFLE, PLAY_REPEAT1, PLAY_REPEATALL]
  const i = order.indexOf(app.st.playMode)
  app.st.playMode = order[(i + 1) % order.length] ?? PLAY_SEQ
  app.pl.play_mode = app.st.playMode
  view_play_mode_btn(app.refs, app.st.playMode)
  save_state(app)
}
function toggle_reverse(app) {
  app.st.reverse = !app.st.reverse
  eng_reverse(app.eng)
  wf_set_mirrored(app.ui.wf, app.st.reverse)
  if (app.cur_meta) {
    apply_track_loop(app, app.cur_meta)
  }
  view_toggle(app.refs, 'btn_reverse', app.st.reverse)
  save_state(app)
}
function on_engine_event(app, ev) {
  switch (ev.type) {
    case 'position': {
      app.pos_cur = ev.current
      app.pos_total = ev.total
      app.last_pos = ev.current
      ms_update_position(app)
      if (!app.pos_raf) {
        app.pos_raf = true
        requestAnimationFrame(() => {
          app.pos_raf = false
          view_position(app.refs, app.ui.wf, app.pos_cur, app.pos_total)
        })
      }
      break
    }
    case 'ended':
      handle_ended(app)
      break
    case 'loaded':
      view_time_total(app.refs, ev.duration)
      break
    case 'bpm': {
      const tid = app.bpm_track_id
      app.bpm_track_id = null
      if (tid === null) {
        break
      }
      const target = app.metas.get(tid)
      if (!target) {
        break
      }
      target.bpm = ev.value
      void db_put_track_meta(app.db, target)
      if (app.cur_meta && app.cur_meta.id === tid) {
        app.st.bpm = ev.value
        view_bpm(app.refs, ev.value)
        save_state(app)
      }
      break
    }
  }
}
function ms_update_metadata(meta) {
  if (!('mediaSession' in navigator)) {
    return
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.name,
    artist: '黙々ノロえもん',
  })
}
function ms_update_position(app) {
  if (!('mediaSession' in navigator)) {
    return
  }
  const now = performance.now()
  if (now - app.ms_pos_at < 1000) {
    return
  }
  app.ms_pos_at = now
  if (!(app.pos_total > 0) || !('setPositionState' in navigator.mediaSession)) {
    return
  }
  try {
    navigator.mediaSession.setPositionState({
      duration: app.pos_total,
      playbackRate: app.st.tempo,
      position: clamp(app.pos_cur, 0, app.pos_total),
    })
  } catch {}
}
function ms_init(app) {
  if (!('mediaSession' in navigator)) {
    return
  }
  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => {
    if (!app.playing) {
      play_toggle(app)
    }
  })
  ms.setActionHandler('pause', () => {
    if (app.playing) {
      play_toggle(app)
    }
  })
  ms.setActionHandler('previoustrack', () => do_prev(app))
  ms.setActionHandler('nexttrack', () => do_next(app))
  try {
    ms.setActionHandler('seekbackward', (d) => {
      eng_seek(app.eng, Math.max(0, app.last_pos - (d.seekOffset ?? 10)))
    })
    ms.setActionHandler('seekforward', (d) => {
      eng_seek(app.eng, app.last_pos + (d.seekOffset ?? 10))
    })
    ms.setActionHandler('seekto', (d) => {
      if (typeof d.seekTime === 'number') {
        eng_seek(app.eng, d.seekTime)
      }
    })
  } catch {}
}
async function export_wav(app) {
  if (!app.cur_audio || !app.cur_meta || app.exporting) {
    if (!app.cur_meta) {
      view_toast('エクスポートする曲がありません', true)
    }
    return
  }
  const out_sec = app.cur_meta.duration / app.st.tempo
  if (out_sec > 900) {
    if (
      !view_confirm(
        '書き出しは約 ' +
          String(Math.floor(out_sec / 60)) +
          ' 分ぶんになります。\n長時間ファイルはメモリ上限でブラウザが落ちる可能性があります。続行しますか？',
      )
    ) {
      return
    }
  }
  app.exporting = true
  view_export_busy(app.refs, true)
  view_toast('オフラインレンダリング中…', false)
  try {
    const rendered = await eng_render_offline(app.eng, app.cur_audio, app.st)
    wav_download(rendered, app.cur_meta.name)
    view_toast('WAVを書き出しました', false)
  } catch {
    view_toast('エクスポートに失敗しました', true)
  } finally {
    app.exporting = false
    view_export_busy(app.refs, false)
  }
}
function open_settings(app) {
  const modal = view_settings_toggle(
    {
      theme: app.settings.theme,
      formant_def: app.settings.formantDef,
      bpm_auto: app.settings.bpmAuto,
      viz_mode: app.ui.vz.mode,
    },
    {
      on_theme: (mode) => {
        app.settings.theme = mode
        theme_apply(mode)
        save_settings(app)
      },
      on_formant_def: (on) => {
        app.settings.formantDef = on
        save_settings(app)
      },
      on_bpm_auto: (on) => {
        app.settings.bpmAuto = on
        save_settings(app)
      },
      on_viz_mode: (mode) => {
        app.settings.vizMode = mode
        vz_set_mode(app.ui.vz, mode)
        save_settings(app)
      },
    },
  )
  if (!modal) {
    return
  }
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    void navigator.storage.estimate().then((est) => {
      modal.set_storage(est.usage ?? 0, est.quota ?? 1)
    })
  } else {
    modal.set_storage_unsupported()
  }
}
function cycle_theme(app) {
  const order = [THEME_AUTO, THEME_LIGHT, THEME_DARK]
  const i = order.indexOf(app.settings.theme)
  const next = order[(i + 1) % order.length] ?? THEME_AUTO
  app.settings.theme = next
  theme_apply(next)
  save_settings(app)
  const names = {
    [THEME_AUTO]: 'テーマ: 自動',
    [THEME_LIGHT]: 'テーマ: ライト',
    [THEME_DARK]: 'テーマ: ダーク',
  }
  view_toast(names[next], false)
}
function set_view(app, v) {
  app.view = v
  view_set_view(app.refs, v)
}
function make_handlers(app) {
  return {
    on_open: () => open_file_picker(app),
    on_play_toggle: () => play_toggle(app),
    on_stop: () => do_stop(app),
    on_prev: () => do_prev(app),
    on_next: () => do_next(app),
    on_loop_cycle: () => cycle_loop_mode(app),
    on_play_mode_cycle: () => cycle_play_mode(app),
    on_ab_clear: () => {
      app.st.loopMode = LOOP_NONE
      app.st.loopStart = 0
      app.st.loopEnd = 0
      eng_clear_loop(app.eng)
      wf_clear_loop(app.ui.wf)
      view_loop_btn(app.refs, app.st.loopMode)
      save_state(app)
      if (app.cur_meta) {
        void persist_track_loop(app, app.cur_meta, null)
      }
    },
    on_vocal: () => {
      app.st.vocalCancel = !app.st.vocalCancel
      eng_set_vocal_cancel(app.eng, app.st.vocalCancel)
      view_toggle(app.refs, 'btn_vocal', app.st.vocalCancel)
      save_state(app)
    },
    on_reverse: () => toggle_reverse(app),
    on_bc: () => {
      app.st.bitcrusherEnabled = !app.st.bitcrusherEnabled
      eng_set_bitcrusher(
        app.eng,
        app.st.bitcrusherBits,
        app.st.bitcrusherReduction,
        app.st.bitcrusherEnabled,
      )
      view_toggle(app.refs, 'btn_bc_toggle', app.st.bitcrusherEnabled)
      save_state(app)
    },
    on_formant: () => {
      app.st.formant = !app.st.formant
      eng_set_formant(app.eng, app.st.formant, app.st.pitch)
      view_toggle(app.refs, 'btn_formant', app.st.formant)
      save_state(app)
    },
    on_mod: () => {
      app.st.mod.en = !app.st.mod.en
      eng_set_modulation(app.eng, app.st.mod)
      view_toggle(app.refs, 'btn_mod_toggle', app.st.mod.en)
      save_state(app)
    },
    on_comp: () => {
      app.st.comp.en = !app.st.comp.en
      eng_set_compressor(app.eng, app.st.comp)
      view_toggle(app.refs, 'btn_comp_toggle', app.st.comp.en)
      save_state(app)
    },
    on_export: () => {
      void export_wav(app)
    },
    on_settings: () => open_settings(app),
    on_theme: () => cycle_theme(app),
    on_mic: () => {
      void (async () => {
        if (eng_mic_active(app.eng)) {
          eng_stop_mic(app.eng)
          view_toggle(app.refs, 'btn_mic', false)
          vz_set_playing(app.ui.vz, app.playing)
        } else {
          const ok = await eng_start_mic(app.eng)
          if (ok) {
            view_toggle(app.refs, 'btn_mic', true)
            vz_set_playing(app.ui.vz, true)
          } else {
            view_toast('マイクへのアクセスを許可してください', true)
          }
        }
      })()
    },
    on_add_track: () => open_file_picker(app),
    on_add_playlist: () => {
      const name = 'プレイリスト ' + String(pl_all(app.pl).length + 1)
      void pl_create(app.pl, name).then(() => render_playlist(app))
    },
    on_nav: (v) => set_view(app, v),
    on_eq_preset: (name) => {
      const preset = EQ_PRESETS.find((pr) => pr.name === name)
      if (!preset) {
        return
      }
      app.st.eqGains = [...preset.bands]
      eq_bank_set(app.ui.eq, app.st.eqGains)
      eng_set_eq_all(app.eng, app.st.eqGains)
      save_state(app)
    },
    on_mod_mode: (value) => {
      const mode =
        value === MOD_CHORUS ? MOD_CHORUS : value === MOD_PHASER ? MOD_PHASER : MOD_FLANGER
      app.st.mod.mode = mode
      eng_set_modulation(app.eng, app.st.mod)
      save_state(app)
    },
    on_seek_delta: (sec) => {
      eng_seek(app.eng, Math.max(0, app.last_pos + sec))
    },
    on_tempo_delta: (delta) => {
      knob_set(app.ui.k_tempo, app.ui.k_tempo.value + delta, true)
    },
    on_viz_click: () => {
      app.settings.vizMode = app.ui.vz.mode
      save_settings(app)
    },
  }
}
function start_pitch_chip(app) {
  window.setInterval(() => {
    if (doc_hidden()) {
      return
    }
    if (!app.playing && !eng_mic_active(app.eng)) {
      view_pitch_chip(app.refs, '')
      return
    }
    const p = eng_detect_pitch(app.eng)
    view_pitch_chip(app.refs, p ? p.note + ' ' + p.hz.toFixed(1) + 'Hz' : '')
  }, 400)
}
export async function app_init() {
  const refs = refs_init()
  const { st, settings } = load_persisted()
  theme_apply(settings.theme)
  const db = await db_open()
  if (db.mode === 'memory') {
    view_toast(
      '⚠️ ストレージ利用不可（プライベートブラウズ？）— このセッション中のみ動作します',
      true,
    )
  }
  const eng = await eng_init()
  const pl = pl_new(db)
  await pl_load(pl)
  pl.play_mode = st.playMode
  const metas = await db_all_metas(db)
  metas.sort((a, b) => a.addedAt - b.addedAt)
  if (await db_has_legacy_audio(db)) {
    view_toast('旧形式のトラックがあります。再インポートで新ストレージへ移行できます', false)
  }
  const ui = view_controls_new(refs, st)
  vz_connect(ui.vz, eng.analyser)
  vz_set_mode(ui.vz, settings.vizMode)
  const app = {
    eng,
    db,
    pl,
    refs,
    ui,
    st,
    settings,
    playing: false,
    cur_meta: null,
    cur_audio: null,
    metas: new Map(metas.map((m) => [m.id, m])),
    loading_id: null,
    bpm_track_id: null,
    exporting: false,
    last_pos: 0,
    pos_raf: false,
    pos_cur: 0,
    pos_total: 0,
    ms_pos_at: 0,
    view: 'player',
  }
  Object.seal(app)
  eng_on(eng, (ev) => on_engine_event(app, ev))
  bind_widget_handlers(app)
  sync_widgets(app)
  view_play_btn(refs, false)
  view_loop_btn(refs, st.loopMode)
  view_play_mode_btn(refs, st.playMode)
  view_toggles(refs, st)
  view_wire(refs, ui, make_handlers(app))
  ms_init(app)
  set_view(app, 'player')
  start_pitch_chip(app)
  eng.ctx.addEventListener('statechange', () => {
    if (eng.ctx.state === 'suspended' && app.playing) {
      app.playing = false
      vz_set_playing(ui.vz, false)
      view_play_btn(refs, false)
    }
  })
  on_visibility((hidden) => {
    if (!hidden && eng.ctx.state === 'suspended' && app.playing) {
      void eng.ctx.resume()
    }
  })
  if (st.currentPlaylistId && pl.lists.has(st.currentPlaylistId)) {
    pl_set_current(pl, st.currentPlaylistId)
  } else {
    const first = pl_all(pl)[0]
    if (first) {
      pl_set_current(pl, first.id)
    }
  }
  for (const pruned of pl_prune(pl, new Set(app.metas.keys()))) {
    await db_update_playlist(db, pruned)
  }
  render_playlist(app)
  if (st.currentTrackId && app.metas.has(st.currentTrackId)) {
    await load_track(app, st.currentTrackId, false)
  }
}
