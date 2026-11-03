import {
  eng_init,
  eng_decode,
  eng_decode_at,
  eng_load,
  eng_release,
  eng_stems,
  eng_stems_clear,
  eng_stem_gains,
  eng_play,
  eng_pause,
  eng_stop,
  eng_seek,
  eng_set_loop,
  eng_clear_loop,
  eng_beats,
  eng_apply,
  eng_fade,
  eng_detect_pitch,
  eng_start_mic,
  eng_stop_mic,
  eng_mic_active,
  eng_render_offline,
  eng_on,
  eng_resume,
  fx_params_default,
  MD_MODES,
} from '../engine.js'
import type { eng_t, eng_event_t, mix_params_t } from '../engine.js'
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
  db_stems_save,
  db_stems_load,
  db_stems_delete,
} from '../store/db.js'
import type { db_t } from '../store/db.js'
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
import type { pl_t } from '../store/playlist.js'
import { knob_set, slider_set, eq_bank_set } from './widgets.js'
import {
  wf_reset,
  wf_set_peaks,
  wf_set_pos,
  wf_set_loop,
  wf_clear_loop,
  wf_set_mirrored,
  wf_set_markers,
} from './waveform.js'
import { vz_connect, vz_set_playing, vz_set_mode } from './visualizer.js'
import { theme_apply } from './theme.js'
import { wav_download, wav_encode_planar, file_download } from '../dsp/wav.js'
import { doc_hidden, on_visibility, el_active } from './dom.js'
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
  view_key,
  view_pitch_chip,
  view_export_busy,
  view_set_view,
  view_playlist_render,
  view_playlist_highlight,
  view_settings_toggle,
  view_fill_select,
  sep_view_status,
  sep_view_progress,
  sep_view_run_btn,
  sep_view_stems,
} from './view.js'
import type {
  refs_t,
  ui_t,
  mobile_view_t,
  wire_handlers_t,
  pl_view_handlers_t,
  stem_row_view_t,
} from './view.js'
import {
  default_state,
  default_settings,
  default_practice,
  clamp,
  semis_to_ratio,
  key_name,
  is_rec,
  field,
  num_or,
  bool_or,
  str_or,
  EQ_PRESETS,
  EQ_BANDS,
  REVERB_TYPES,
  SPECIALS,
  STEM_ORDER,
  STEM_NAMES,
  LOOP_NONE,
  LOOP_SINGLE,
  LOOP_AB,
  LOOP_MARK,
  LOOP_ALL,
  PLAY_SEQ,
  PLAY_SHUFFLE,
  PLAY_REPEAT1,
  PLAY_REPEATALL,
  MOD_FLANGER,
  MOD_CHORUS,
  MOD_PHASER,
  MOD_TREMOLO,
  VIZ_WAVE,
  VIZ_BARS,
  THEME_AUTO,
  THEME_LIGHT,
  THEME_DARK,
  PITCH_MIN,
  PITCH_MAX,
  TEMPO_MIN,
  TEMPO_MAX,
  RATE_MIN,
  RATE_MAX,
  SP_NONE,
  SP_RECORD,
  SP_BATTERY,
  SP_NOSENSE,
  SP_BASS,
  SP_HIHAT,
  SP_EAR,
  EXPORT_16,
  EXPORT_24,
  EXPORT_32F,
  AI_AUTO,
  AI_WEBGPU,
  AI_WASM,
} from '../types.js'
import type {
  player_state_t,
  settings_t,
  track_meta_t,
  ab_loop_t,
  loop_mode_t,
  play_mode_t,
  mod_mode_t,
  theme_mode_t,
  special_t,
  stem_mix_t,
  stems_meta_t,
} from '../types.js'

type sep_state_t = {
  w: Worker | null
  inited: boolean
  ready: boolean
  busy: boolean
  job: number
  track_id: string | null
  model: string
  backend: string
  t0: number
  file: File | null
  active: string[]
  wait: ((ok: boolean) => void) | null
}

type preset_t = {
  name: string
  data: Record<string, unknown>
}

type app_t = {
  eng: eng_t
  db: db_t
  pl: pl_t
  refs: refs_t
  ui: ui_t
  st: player_state_t
  settings: settings_t
  playing: boolean
  cur_meta: track_meta_t | null
  cur_audio: ArrayBuffer | null
  metas: Map<string, track_meta_t>
  loading_id: string | null
  ana_job: number
  ana_track_id: string | null
  exporting: boolean
  last_pos: number
  pos_raf: boolean
  pos_cur: number
  pos_total: number
  ms_pos_at: number
  view: mobile_view_t
  loop_n: number
  loop_released: boolean
  ear_eq: number[] | null
  ear_pan: number
  ear_timer: number
  sleep_min: number
  sleep_timer: number
  save_timer: number
  fading: boolean
  ended: boolean
  sep: sep_state_t
  presets: preset_t[]
}

const NORM_TARGET = -14
const VENDOR_ORT = './vendor/ort/'
const SEP_URL = new URL('../worker/sep.js', import.meta.url).href

function save_state_now(app: app_t): void {
  if (app.save_timer !== 0) {
    clearTimeout(app.save_timer)
    app.save_timer = 0
  }
  try {
    localStorage.setItem('wf-state', JSON.stringify(app.st))
  } catch {}
}

function save_state(app: app_t): void {
  if (app.save_timer !== 0) {
    return
  }
  app.save_timer = window.setTimeout(() => {
    app.save_timer = 0
    save_state_now(app)
  }, 300)
}

function save_settings(app: app_t): void {
  try {
    localStorage.setItem('wf-settings', JSON.stringify(app.settings))
  } catch {}
}

function json_read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return null
    }
    const v: unknown = JSON.parse(raw)
    return v
  } catch {
    return null
  }
}

function sub(o: object, k: string): object | null {
  const v = field(o, k)
  return is_rec(v) ? v : null
}

function state_merge(d: player_state_t, r: object, full: boolean): void {
  if (full) {
    const ct = field(r, 'currentTrackId')
    const cp = field(r, 'currentPlaylistId')
    d.currentTrackId = typeof ct === 'string' ? ct : null
    d.currentPlaylistId = typeof cp === 'string' ? cp : null
    d.volume = clamp(num_or(field(r, 'volume'), d.volume), 0, 1)
    const lm = field(r, 'loopMode')
    d.loopMode =
      lm === LOOP_SINGLE || lm === LOOP_AB || lm === LOOP_MARK || lm === LOOP_ALL ? lm : LOOP_NONE
    d.loopStart = Math.max(0, num_or(field(r, 'loopStart'), 0))
    d.loopEnd = Math.max(0, num_or(field(r, 'loopEnd'), 0))
    const pm = field(r, 'playMode')
    d.playMode = pm === PLAY_SHUFFLE || pm === PLAY_REPEAT1 || pm === PLAY_REPEATALL ? pm : PLAY_SEQ
    d.bpm = Math.max(0, num_or(field(r, 'bpm'), 0))
    d.reverse = bool_or(field(r, 'reverse'), false)
    const pr = sub(r, 'practice')
    if (pr) {
      d.practice.loopCount = clamp(Math.round(num_or(field(pr, 'loopCount'), 0)), 0, 20)
      d.practice.loopStep = clamp(num_or(field(pr, 'loopStep'), 0), -10, 10)
      d.practice.loopTarget = clamp(num_or(field(pr, 'loopTarget'), 100), 25, 400)
      d.practice.click = bool_or(field(pr, 'click'), false)
      d.practice.clickVol = clamp(num_or(field(pr, 'clickVol'), 0.5), 0, 1)
    }
    const sm = sub(r, 'stems')
    if (sm) {
      for (const k of Object.keys(sm)) {
        const v = sub(sm, k)
        if (v) {
          d.stems[k] = {
            gain: clamp(num_or(field(v, 'gain'), 1), 0, 2),
            mute: bool_or(field(v, 'mute'), false),
            solo: bool_or(field(v, 'solo'), false),
          }
        }
      }
    }
  }
  d.pitch = clamp(num_or(field(r, 'pitch'), d.pitch), PITCH_MIN, PITCH_MAX)
  d.tempo = clamp(num_or(field(r, 'tempo'), d.tempo), TEMPO_MIN, TEMPO_MAX)
  d.rate = clamp(num_or(field(r, 'rate'), d.rate), RATE_MIN, RATE_MAX)
  const eq = field(r, 'eqGains')
  if (Array.isArray(eq) && eq.length === EQ_BANDS.length) {
    d.eqGains = eq.map((g: unknown) => clamp(num_or(g, 0), -12, 12))
  }
  d.reverb = clamp(num_or(field(r, 'reverb'), d.reverb), 0, 1)
  const rt = field(r, 'reverbType')
  d.reverbType = REVERB_TYPES.some((x) => x.id === rt) ? str_or(rt, 'hall') : d.reverbType
  d.bitcrusherBits = clamp(num_or(field(r, 'bitcrusherBits'), d.bitcrusherBits), 1, 16)
  d.bitcrusherReduction = clamp(
    num_or(field(r, 'bitcrusherReduction'), d.bitcrusherReduction),
    1,
    32,
  )
  d.bitcrusherEnabled = bool_or(field(r, 'bitcrusherEnabled'), d.bitcrusherEnabled)
  d.vocalCancel = bool_or(field(r, 'vocalCancel'), d.vocalCancel)
  d.formant = bool_or(field(r, 'formant'), d.formant)
  d.normalize = bool_or(field(r, 'normalize'), d.normalize)
  d.limiter = bool_or(field(r, 'limiter'), d.limiter)
  d.chMode = clamp(Math.round(num_or(field(r, 'chMode'), d.chMode)), 0, 4)
  d.pan = clamp(num_or(field(r, 'pan'), d.pan), -1, 1)
  d.width = clamp(num_or(field(r, 'width'), d.width), 0, 2)
  const rm = sub(r, 'mod')
  if (rm) {
    const mm = field(rm, 'mode')
    d.mod.mode = mm === MOD_CHORUS || mm === MOD_PHASER || mm === MOD_TREMOLO ? mm : MOD_FLANGER
    d.mod.rate = clamp(num_or(field(rm, 'rate'), d.mod.rate), 0.01, 10)
    d.mod.depth = clamp(num_or(field(rm, 'depth'), d.mod.depth), 0, 1)
    d.mod.fb = clamp(num_or(field(rm, 'fb'), d.mod.fb), -0.95, 0.95)
    d.mod.mix = clamp(num_or(field(rm, 'mix'), d.mod.mix), 0, 1)
    d.mod.en = bool_or(field(rm, 'en'), false)
  }
  const rc = sub(r, 'comp')
  if (rc) {
    d.comp.thr = clamp(num_or(field(rc, 'thr'), d.comp.thr), -60, 0)
    d.comp.rat = clamp(num_or(field(rc, 'rat'), d.comp.rat), 1, 20)
    d.comp.atk = clamp(num_or(field(rc, 'atk'), d.comp.atk), 0.1, 200)
    d.comp.rel = clamp(num_or(field(rc, 'rel'), d.comp.rel), 10, 2000)
    d.comp.mkup = clamp(num_or(field(rc, 'mkup'), d.comp.mkup), 0, 40)
    d.comp.en = bool_or(field(rc, 'en'), false)
  }
  const rd = sub(r, 'delay')
  if (rd) {
    d.delay.time = clamp(num_or(field(rd, 'time'), d.delay.time), 10, 2000)
    d.delay.fb = clamp(num_or(field(rd, 'fb'), d.delay.fb), 0, 0.95)
    d.delay.mix = clamp(num_or(field(rd, 'mix'), d.delay.mix), 0, 1)
    d.delay.damp = clamp(num_or(field(rd, 'damp'), d.delay.damp), 0, 1)
    d.delay.pp = bool_or(field(rd, 'pp'), false)
    d.delay.en = bool_or(field(rd, 'en'), false)
  }
  const rx = sub(r, 'dist')
  if (rx) {
    d.dist.drive = clamp(num_or(field(rx, 'drive'), d.dist.drive), 0, 48)
    d.dist.tone = clamp(num_or(field(rx, 'tone'), d.dist.tone), 0, 1)
    d.dist.mix = clamp(num_or(field(rx, 'mix'), d.dist.mix), 0, 1)
    d.dist.en = bool_or(field(rx, 'en'), false)
  }
}

function load_persisted(): {
  st: player_state_t
  settings: settings_t
} {
  const d = default_state()
  const r = json_read('wf-state')
  if (is_rec(r)) {
    state_merge(d, r, true)
  }
  const s = default_settings()
  const rs = json_read('wf-settings')
  if (is_rec(rs)) {
    s.formantDef = bool_or(field(rs, 'formantDef'), s.formantDef)
    s.bpmAuto = bool_or(field(rs, 'bpmAuto'), s.bpmAuto)
    s.vizMode = field(rs, 'vizMode') === VIZ_WAVE ? VIZ_WAVE : VIZ_BARS
    const th = field(rs, 'theme')
    s.theme = th === THEME_LIGHT || th === THEME_DARK ? th : THEME_AUTO
    const ef = field(rs, 'exportFmt')
    s.exportFmt = ef === EXPORT_24 ? EXPORT_24 : ef === EXPORT_32F ? EXPORT_32F : EXPORT_16
    s.fadeStop = clamp(num_or(field(rs, 'fadeStop'), 0), 0, 10)
    s.resume = bool_or(field(rs, 'resume'), s.resume)
    const ab = field(rs, 'aiBackend')
    s.aiBackend = ab === AI_WEBGPU ? AI_WEBGPU : ab === AI_WASM ? AI_WASM : AI_AUTO
    s.aiHq = bool_or(field(rs, 'aiHq'), false)
    const am = field(rs, 'aiModel')
    if (typeof am === 'string' && am !== '') {
      s.aiModel = am
    }
  }
  if (!is_rec(r)) {
    d.formant = s.formantDef
  }
  return { st: d, settings: s }
}

function norm_gain(app: app_t): number {
  const m = app.cur_meta
  if (!app.st.normalize || !m || m.lufs === undefined || m.lufs <= -69) {
    return 1
  }
  return clamp(Math.pow(10, (NORM_TARGET - m.lufs) / 20), 0.1, 4)
}

function eff_pitch(app: app_t): number {
  return clamp(app.st.pitch + (app.st.practice.special === SP_BASS ? 12 : 0), PITCH_MIN, PITCH_MAX)
}

function eff_mix(app: app_t, for_export: boolean): mix_params_t {
  const st = app.st
  const sp = st.practice.special
  const fx = fx_params_default()
  fx.ch_mode = st.chMode
  fx.vc = st.vocalCancel
  fx.pan = st.pan
  fx.width = st.width
  fx.md_en = st.mod.en
  fx.md_mode = MD_MODES[st.mod.mode] ?? 0
  fx.md_rate = st.mod.rate
  fx.md_depth = st.mod.depth
  fx.md_fb = st.mod.fb
  fx.md_mix = st.mod.mix
  fx.ds_en = st.dist.en
  fx.ds_drive = st.dist.drive
  fx.ds_tone = st.dist.tone
  fx.ds_mix = st.dist.mix
  fx.bc_en = st.bitcrusherEnabled
  fx.bc_bits = st.bitcrusherBits
  fx.bc_red = st.bitcrusherReduction
  fx.dl_en = st.delay.en
  fx.dl_time = st.delay.time
  fx.dl_fb = st.delay.fb
  fx.dl_mix = st.delay.mix
  fx.dl_pp = st.delay.pp
  fx.dl_damp = st.delay.damp
  fx.cp_en = st.comp.en
  fx.cp_thr = st.comp.thr
  fx.cp_rat = st.comp.rat
  fx.cp_atk = st.comp.atk
  fx.cp_rel = st.comp.rel
  fx.cp_mk = st.comp.mkup
  let eq = [...st.eqGains]
  let wander = 0
  let formant = st.formant
  switch (sp) {
    case SP_RECORD:
      wander = 1
      fx.nz_en = true
      fx.nz_amt = 0.6
      fx.hp = 220
      fx.lp = 6000
      break
    case SP_BATTERY:
      wander = 2
      fx.ds_en = true
      fx.ds_drive = 16
      fx.ds_tone = 0.35
      fx.ds_mix = 0.6
      fx.hp = 300
      fx.lp = 3800
      break
    case SP_NOSENSE:
      wander = 3
      break
    case SP_BASS:
      formant = false
      fx.lp = 700
      break
    case SP_HIHAT:
      fx.hp = 5500
      break
    case SP_EAR:
      if (app.ear_eq) {
        eq = [...app.ear_eq]
      }
      fx.pan = app.ear_pan
      break
  }
  return {
    pv: {
      pitch: semis_to_ratio(eff_pitch(app)),
      tempo: st.tempo,
      rate: st.rate,
      formant,
      dir: st.reverse ? -1 : 1,
    },
    fx,
    eq,
    reverb: st.reverb,
    reverb_type: st.reverbType,
    gain: (for_export ? 1 : st.volume) * norm_gain(app),
    limiter: st.limiter,
    wander,
  }
}

function sync_engine(app: app_t): void {
  eng_apply(app.eng, eff_mix(app, false))
}

function stem_mix(app: app_t, name: string): stem_mix_t {
  let m = app.st.stems[name]
  if (!m) {
    m = { gain: 1, mute: false, solo: false }
    app.st.stems[name] = m
  }
  return m
}

function stem_gains(app: app_t): Float32Array {
  const act = app.sep.active
  const g = new Float32Array(act.length)
  let any_solo = false
  for (const n of act) {
    if (stem_mix(app, n).solo) {
      any_solo = true
    }
  }
  const bass_solo = !any_solo && app.st.practice.special === SP_BASS && act.includes('bass')
  for (let i = 0; i < act.length; i++) {
    const n = act[i] ?? ''
    const m = stem_mix(app, n)
    let v = m.gain
    if (bass_solo) {
      v = n === 'bass' ? 1 : 0
    } else if (any_solo) {
      v = m.solo ? v : 0
    } else if (m.mute) {
      v = 0
    }
    g[i] = v
  }
  return g
}

function sync_stems(app: app_t): void {
  if (app.sep.active.length > 0) {
    eng_stem_gains(app.eng, stem_gains(app))
  }
}

function sync_beats(app: app_t): void {
  const m = app.cur_meta
  const bpm = m?.bpm ?? 0
  eng_beats(app.eng, {
    on: app.st.practice.click && bpm > 0,
    bpm,
    ofs: m?.beat ?? 0,
    vol: app.st.practice.clickVol,
  })
}

function sync_info_chips(app: app_t): void {
  const m = app.cur_meta
  const speed = app.st.tempo * app.st.rate
  view_bpm(app.refs, m?.bpm ?? 0, speed)
  const shift = eff_pitch(app) + 12 * Math.log2(app.st.rate)
  if (m && m.key !== undefined) {
    const now = key_name(m.key, shift)
    const orig = key_name(m.key, 0)
    view_key(app.refs, now, now === orig ? '推定キー' : '原曲のキー: ' + orig)
  } else {
    view_key(app.refs, '', '')
  }
}

function on_tempo_like_change(app: app_t): void {
  sync_engine(app)
  sync_info_chips(app)
  save_state(app)
}

function bind_widget_handlers(app: app_t): void {
  const ui = app.ui
  const st = app.st
  const fx_change = (): void => {
    sync_engine(app)
    save_state(app)
  }
  ui.k_pitch.on_change = (v): void => {
    st.pitch = v
    on_tempo_like_change(app)
  }
  ui.k_tempo.on_change = (v): void => {
    st.tempo = v / 100
    on_tempo_like_change(app)
  }
  ui.k_rate.on_change = (v): void => {
    st.rate = v / 100
    on_tempo_like_change(app)
  }
  ui.k_vol.on_change = (v): void => {
    st.volume = v / 100
    fx_change()
  }
  ui.wf.on_seek = (t): void => {
    if (app.eng.duration > 0) {
      const sec = t * app.eng.duration
      do_seek(app, sec)
    }
  }
  ui.wf.on_loop = (s, en): void => {
    set_ab(app, s, en)
  }
  ui.wf.on_marker_del = (i): void => {
    marker_delete(app, i)
  }
  ui.eq.on_change = (i, v): void => {
    st.eqGains[i] = v
    fx_change()
  }
  ui.s_reverb.on_change = (v): void => {
    st.reverb = v / 100
    fx_change()
  }
  ui.s_bits.on_change = (v): void => {
    st.bitcrusherBits = v
    fx_change()
  }
  ui.s_red.on_change = (v): void => {
    st.bitcrusherReduction = v
    fx_change()
  }
  ui.k_mrate.on_change = (v): void => {
    st.mod.rate = v
    fx_change()
  }
  ui.k_mdepth.on_change = (v): void => {
    st.mod.depth = v
    fx_change()
  }
  ui.k_mfb.on_change = (v): void => {
    st.mod.fb = v
    fx_change()
  }
  ui.k_mmix.on_change = (v): void => {
    st.mod.mix = v
    fx_change()
  }
  ui.s_cthr.on_change = (v): void => {
    st.comp.thr = v
    fx_change()
  }
  ui.s_crat.on_change = (v): void => {
    st.comp.rat = v
    fx_change()
  }
  ui.s_catk.on_change = (v): void => {
    st.comp.atk = v
    fx_change()
  }
  ui.s_crel.on_change = (v): void => {
    st.comp.rel = v
    fx_change()
  }
  ui.s_cmk.on_change = (v): void => {
    st.comp.mkup = v
    fx_change()
  }
  ui.s_dtime.on_change = (v): void => {
    st.delay.time = v
    fx_change()
  }
  ui.s_dfb.on_change = (v): void => {
    st.delay.fb = v / 100
    fx_change()
  }
  ui.s_dmix.on_change = (v): void => {
    st.delay.mix = v / 100
    fx_change()
  }
  ui.s_ddamp.on_change = (v): void => {
    st.delay.damp = v / 100
    fx_change()
  }
  ui.s_xdrive.on_change = (v): void => {
    st.dist.drive = v
    fx_change()
  }
  ui.s_xtone.on_change = (v): void => {
    st.dist.tone = v / 100
    fx_change()
  }
  ui.s_xmix.on_change = (v): void => {
    st.dist.mix = v / 100
    fx_change()
  }
  ui.s_pan.on_change = (v): void => {
    st.pan = v / 100
    fx_change()
  }
  ui.s_width.on_change = (v): void => {
    st.width = v / 100
    fx_change()
  }
  ui.s_lcount.on_change = (v): void => {
    st.practice.loopCount = Math.round(v)
    app.loop_n = 0
    save_state(app)
  }
  ui.s_lstep.on_change = (v): void => {
    st.practice.loopStep = v
    save_state(app)
  }
  ui.s_ltarget.on_change = (v): void => {
    st.practice.loopTarget = v
    save_state(app)
  }
  ui.s_clickvol.on_change = (v): void => {
    st.practice.clickVol = v / 100
    sync_beats(app)
    save_state(app)
  }
}

function sync_widgets(app: app_t): void {
  const ui = app.ui
  const st = app.st
  knob_set(ui.k_pitch, st.pitch, false)
  knob_set(ui.k_tempo, st.tempo * 100, false)
  knob_set(ui.k_rate, st.rate * 100, false)
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
  slider_set(ui.s_dtime, st.delay.time, false)
  slider_set(ui.s_dfb, st.delay.fb * 100, false)
  slider_set(ui.s_dmix, st.delay.mix * 100, false)
  slider_set(ui.s_ddamp, st.delay.damp * 100, false)
  slider_set(ui.s_xdrive, st.dist.drive, false)
  slider_set(ui.s_xtone, st.dist.tone * 100, false)
  slider_set(ui.s_xmix, st.dist.mix * 100, false)
  slider_set(ui.s_pan, st.pan * 100, false)
  slider_set(ui.s_width, st.width * 100, false)
  slider_set(ui.s_lcount, st.practice.loopCount, false)
  slider_set(ui.s_lstep, st.practice.loopStep, false)
  slider_set(ui.s_ltarget, st.practice.loopTarget, false)
  slider_set(ui.s_clickvol, st.practice.clickVol * 100, false)
  el_active(ui.b_dpp, st.delay.pp)
  app.refs.mod_mode_select.value = st.mod.mode
  app.refs.reverb_type_select.value = st.reverbType
  app.refs.ch_mode_select.value = String(st.chMode)
  app.refs.special_select.value = st.practice.special
  view_toggles(app.refs, st)
}

function render_playlist(app: app_t): void {
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
  const tracks: { id: string; name: string; duration: number }[] = []
  for (const tid of cur.trackIds) {
    const m = app.metas.get(tid)
    if (m) {
      tracks.push({ id: tid, name: m.name, duration: m.duration })
    }
  }
  view_playlist_render(
    app.refs,
    tabs,
    tracks,
    app.cur_meta ? app.cur_meta.id : null,
    playlist_handlers(app),
  )
}

function playlist_handlers(app: app_t): pl_view_handlers_t {
  return {
    on_tab_select: (id: string): void => {
      pl_set_current(app.pl, id)
      app.st.currentPlaylistId = id
      save_state(app)
      render_playlist(app)
    },
    on_tab_rename: (id: string): void => {
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
    on_tab_delete: (id: string): void => {
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
    on_track_select: (tid: string): void => {
      void load_track(app, tid, true, false)
      if (app.view === 'playlist') {
        set_view(app, 'player')
      }
    },
    on_track_rename: (tid: string): void => {
      void rename_track(app, tid)
    },
    on_track_delete: (tid: string): void => {
      const meta = app.metas.get(tid)
      if (meta) {
        void delete_track(app, tid, meta.name)
      }
    },
    on_track_reorder: (ids: readonly string[]): void => {
      const cur = pl_current(app.pl)
      if (!cur) {
        return
      }
      void pl_reorder(app.pl, cur.id, ids)
    },
  }
}

async function persist_meta(app: app_t, meta: track_meta_t): Promise<void> {
  const ok = await db_put_track_meta(app.db, meta)
  if (!ok) {
    view_toast('曲の情報を保存できませんでした', true)
  }
}

function ab_valid(meta: track_meta_t): ab_loop_t | null {
  const stored = meta.abLoop
  if (!stored) {
    return null
  }
  const s = clamp(stored.start, 0, meta.duration)
  const en = clamp(stored.end, 0, meta.duration)
  return en - s < 0.05 ? null : { start: s, end: en }
}

function mark_region(app: app_t, meta: track_meta_t, at: number): ab_loop_t | null {
  const mk = meta.markers ?? []
  if (mk.length === 0) {
    return null
  }
  const pts = [0, ...mk.filter((x) => x > 0.01 && x < meta.duration - 0.01), meta.duration]
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] ?? 0
    const b = pts[i + 1] ?? meta.duration
    const inside = app.st.reverse ? at > a && at <= b : at >= a && at < b
    if (inside && b - a > 0.05) {
      return { start: a, end: b }
    }
  }
  return null
}

function apply_track_loop(app: app_t, meta: track_meta_t): void {
  app.loop_n = 0
  app.loop_released = false
  let reg: ab_loop_t | null = null
  if (app.st.loopMode === LOOP_AB) {
    reg = ab_valid(meta)
  } else if (app.st.loopMode === LOOP_MARK) {
    reg = mark_region(app, meta, app.last_pos)
  }
  if (reg) {
    app.st.loopStart = reg.start
    app.st.loopEnd = reg.end
    eng_set_loop(app.eng, reg.start, reg.end)
    wf_set_loop(app.ui.wf, reg.start, reg.end)
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

function set_ab(app: app_t, s: number, en: number): void {
  const meta = app.cur_meta
  if (!meta || en - s < 0.05) {
    return
  }
  meta.abLoop = { start: s, end: en }
  app.st.loopMode = LOOP_AB
  apply_track_loop(app, meta)
  view_loop_btn(app.refs, app.st.loopMode)
  save_state(app)
  void persist_meta(app, meta)
}

function set_a_here(app: app_t): void {
  const meta = app.cur_meta
  if (!meta) {
    return
  }
  const s = clamp(app.last_pos, 0, meta.duration)
  const old = ab_valid(meta)
  const en = old && old.end > s + 0.05 ? old.end : meta.duration
  set_ab(app, s, en)
  view_toast('A を ' + fmt_short(s) + ' に設定', false)
}

function set_b_here(app: app_t): void {
  const meta = app.cur_meta
  if (!meta) {
    return
  }
  const en = clamp(app.last_pos, 0, meta.duration)
  const old = ab_valid(meta)
  const s = old && old.start < en - 0.05 ? old.start : 0
  set_ab(app, s, en)
  view_toast('B を ' + fmt_short(en) + ' に設定', false)
}

function fmt_short(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return String(m) + ':' + s.toFixed(1).padStart(4, '0')
}

function marker_add(app: app_t): void {
  const meta = app.cur_meta
  if (!meta) {
    return
  }
  const t = clamp(app.last_pos, 0, meta.duration)
  const mk = meta.markers ?? []
  if (mk.some((x) => Math.abs(x - t) < 0.05)) {
    return
  }
  mk.push(t)
  mk.sort((a, b) => a - b)
  meta.markers = mk
  wf_set_markers(app.ui.wf, mk)
  if (app.st.loopMode === LOOP_MARK) {
    apply_track_loop(app, meta)
  }
  void persist_meta(app, meta)
  view_toast('マーカーを追加しました (' + fmt_short(t) + ')', false)
}

function marker_delete(app: app_t, i: number): void {
  const meta = app.cur_meta
  if (!meta || !meta.markers) {
    return
  }
  meta.markers.splice(i, 1)
  wf_set_markers(app.ui.wf, meta.markers)
  if (app.st.loopMode === LOOP_MARK) {
    apply_track_loop(app, meta)
  }
  void persist_meta(app, meta)
}

function marker_step(app: app_t, dir: number): void {
  const meta = app.cur_meta
  if (!meta) {
    return
  }
  const pts = [0, ...(meta.markers ?? [])]
  const at = app.last_pos
  let target = -1
  if (dir > 0) {
    for (const p of pts) {
      if (p > at + 0.3) {
        target = p
        break
      }
    }
  } else {
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i] ?? 0
      if (p < at - 0.8) {
        target = p
        break
      }
    }
    if (target < 0) {
      target = 0
    }
  }
  if (target >= 0) {
    do_seek(app, target)
  }
}

function do_seek(app: app_t, sec: number): void {
  const dur = app.eng.duration
  const t = clamp(sec, 0, dur > 0 ? dur : sec)
  eng_seek(app.eng, t)
  app.last_pos = t
  app.ended = false
  view_time_current(app.refs, t)
  if (dur > 0) {
    wf_set_pos(app.ui.wf, t / dur)
  }
  if (app.cur_meta && (app.st.loopMode === LOOP_MARK || app.loop_released)) {
    apply_track_loop(app, app.cur_meta)
  }
}

async function rename_track(app: app_t, tid: string): Promise<void> {
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

async function delete_track(app: app_t, tid: string, name: string): Promise<void> {
  if (
    !view_confirm(
      '「' +
        name +
        '」をライブラリから完全に削除しますか？\n（すべてのプレイリストから削除されます）',
    )
  ) {
    return
  }
  if (app.sep.busy && app.sep.track_id === tid) {
    sep_cancel(app)
  }
  await db_delete_track_cascade(app.db, tid)
  pl_forget_track(app.pl, tid)
  app.metas.delete(tid)
  if (app.cur_meta && app.cur_meta.id === tid) {
    eng_stop(app.eng)
    eng_release(app.eng)
    app.cur_meta = null
    app.cur_audio = null
    app.playing = false
    app.sep.active = []
    sep_refresh(app)
    view_play_btn(app.refs, false)
    view_track_name(app.refs, '曲を選んでください', false)
    wf_reset(app.ui.wf, 0)
  }
  render_playlist(app)
}

async function import_file(app: app_t, file: File): Promise<string | null> {
  let buf: ArrayBuffer
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
  'audio/*,video/*,.mp3,.m4a,.m4b,.aac,.wav,.wave,.aif,.aiff,.aifc,.caf,.flac,.ogg,.oga,.opus,.weba,.webm,.mp4,.mov,.mkv'

const AUDIO_EXT =
  /\.(mp3|m4a|m4b|aac|wav|wave|aif|aiff|aifc|caf|flac|ogg|oga|opus|weba|webm|mp4|mov|mkv|3gp)$/i

function import_files(app: app_t, files: File[]): void {
  const list = files.filter(
    (f) => f.type.startsWith('audio/') || f.type.startsWith('video/') || AUDIO_EXT.test(f.name),
  )
  if (list.length === 0) {
    view_toast('音声ファイルが見つかりませんでした', true)
    return
  }
  void (async (): Promise<void> => {
    let ok = 0
    let first_id: string | null = null
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      if (!f) {
        continue
      }
      if (list.length > 1) {
        view_toast('読み込み中 ' + String(i + 1) + ' / ' + String(list.length), false)
      }
      const id = await import_file(app, f)
      if (id) {
        ok++
        if (!first_id) {
          first_id = id
        }
        if (ok % 5 === 0) {
          render_playlist(app)
        }
      }
    }
    if (ok > 0) {
      view_toast(String(ok) + '曲を追加しました', false)
      render_playlist(app)
      if (!app.cur_meta && first_id) {
        await load_track(app, first_id, true, false)
      }
    }
  })()
}

function open_file_picker(app: app_t): void {
  view_pick_files(PICK_ACCEPT, (files) => import_files(app, files))
}

function remember_pos(app: app_t): void {
  const m = app.cur_meta
  if (!m || !app.settings.resume) {
    return
  }
  const p = app.last_pos
  const keep = p > 3 && p < m.duration - 3 ? Math.round(p * 10) / 10 : 0
  if ((m.pos ?? 0) !== keep) {
    if (keep > 0) {
      m.pos = keep
    } else {
      delete m.pos
    }
    void db_put_track_meta(app.db, m)
  }
}

async function load_track(
  app: app_t,
  id: string,
  autoplay: boolean,
  resume: boolean,
): Promise<void> {
  if (app.cur_meta && app.cur_meta.id !== id) {
    remember_pos(app)
  }
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
    const known = app.metas.get(id)
    if (known) {
      Object.assign(known, meta)
    }
    const m = known ?? meta
    const decoded = await eng_decode(app.eng, audio.slice(0))
    if (app.loading_id !== id) {
      return
    }
    eng_stop(app.eng)
    if (app.playing) {
      app.playing = false
      vz_set_playing(app.ui.vz, false)
    }
    app.cur_meta = m
    app.cur_audio = audio
    app.st.currentTrackId = id
    pl_set_current_track(app.pl, id)
    if (Math.abs(m.duration - decoded.duration) > 0.01) {
      m.duration = decoded.duration
    }
    app.sep.active = []
    wf_reset(app.ui.wf, decoded.duration)
    wf_set_markers(app.ui.wf, m.markers ?? [])
    wf_set_mirrored(app.ui.wf, app.st.reverse)
    const need_info =
      app.settings.bpmAuto && (m.lufs === undefined || m.key === undefined || m.bpm === undefined)
    app.ana_track_id = id
    app.ana_job = eng_load(app.eng, decoded, app.st.reverse ? -1 : 1, need_info ? 'all' : 'peaks')
    app.st.bpm = m.bpm ?? 0
    sync_engine(app)
    sync_beats(app)
    sync_info_chips(app)
    const start =
      resume && app.settings.resume && m.pos !== undefined ? m.pos : app.st.reverse ? m.duration : 0
    app.last_pos = start
    app.ended = false
    if (start > 0) {
      eng_seek(app.eng, start)
    }
    apply_track_loop(app, m)
    view_track_name(app.refs, m.name, true)
    view_time_total(app.refs, m.duration)
    view_time_current(app.refs, start)
    wf_set_pos(app.ui.wf, m.duration > 0 ? start / m.duration : 0)
    view_playlist_highlight(app.refs, m.id)
    save_state(app)
    ms_update_metadata(m)
    sep_refresh(app)
    if (m.stems) {
      void stems_restore(app, m)
    }
    if (autoplay) {
      start_play(app)
    } else {
      view_play_btn(app.refs, false)
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

function start_play(app: app_t): void {
  app.playing = true
  app.ended = false
  eng_play(app.eng)
  vz_set_playing(app.ui.vz, true)
  view_play_btn(app.refs, true)
  window.setTimeout(() => {
    if (app.playing && app.eng.ctx.state !== 'running') {
      view_toast('画面をタップすると音が出ます', false)
    }
  }, 400)
}

async function fade_then(app: app_t, act: () => void): Promise<void> {
  const sec = app.settings.fadeStop
  if (sec <= 0 || !app.playing || app.fading) {
    act()
    return
  }
  app.fading = true
  await eng_fade(app.eng, 0, sec)
  act()
  await new Promise((r) => window.setTimeout(r, 60))
  await eng_fade(app.eng, 1, 0.01)
  app.fading = false
}

function play_toggle(app: app_t): void {
  if (!app.cur_meta) {
    return
  }
  if (app.playing) {
    void fade_then(app, () => {
      eng_pause(app.eng)
      app.playing = false
      vz_set_playing(app.ui.vz, false)
      view_play_btn(app.refs, false)
      remember_pos(app)
    })
    return
  }
  if (app.ended) {
    do_seek(app, app.st.reverse ? app.cur_meta.duration : 0)
  }
  start_play(app)
}

function do_stop(app: app_t): void {
  void fade_then(app, () => {
    eng_stop(app.eng)
    app.playing = false
    app.last_pos = app.st.reverse && app.cur_meta ? app.cur_meta.duration : 0
    vz_set_playing(app.ui.vz, false)
    view_play_btn(app.refs, false)
    view_time_current(app.refs, app.last_pos)
    wf_set_pos(app.ui.wf, app.st.reverse ? 1 : 0)
    if (app.cur_meta) {
      if (app.cur_meta.pos !== undefined) {
        delete app.cur_meta.pos
        void db_put_track_meta(app.db, app.cur_meta)
      }
      apply_track_loop(app, app.cur_meta)
    }
  })
}

function do_next(app: app_t): void {
  const id = pl_next_id(app.pl)
  if (id) {
    void load_track(app, id, true, false)
  }
}

function do_prev(app: app_t): void {
  if (app.playing && app.last_pos > 3 && !app.st.reverse) {
    do_seek(app, 0)
    return
  }
  const id = pl_prev_id(app.pl)
  if (id) {
    void load_track(app, id, true, false)
  }
}

function handle_ended(app: app_t): void {
  const st = app.st
  const meta = app.cur_meta
  const head = st.reverse && meta ? meta.duration : 0
  if (st.loopMode === LOOP_SINGLE) {
    eng_seek(app.eng, head)
    eng_play(app.eng)
    return
  }
  if (st.playMode === PLAY_REPEAT1) {
    eng_seek(app.eng, head)
    eng_play(app.eng)
    return
  }
  const next = pl_next_id(app.pl)
  if (next) {
    void load_track(app, next, true, false)
    return
  }
  if (st.playMode === PLAY_REPEATALL || st.loopMode === LOOP_ALL) {
    const cur = pl_current(app.pl)
    const first = cur ? cur.trackIds.find((tid) => app.metas.has(tid)) : undefined
    if (first) {
      void load_track(app, first, true, false)
      return
    }
  }
  app.playing = false
  app.ended = true
  vz_set_playing(app.ui.vz, false)
  view_play_btn(app.refs, false)
}

function on_loop_event(app: app_t): void {
  const st = app.st
  if (st.loopMode !== LOOP_AB && st.loopMode !== LOOP_MARK) {
    return
  }
  app.loop_n++
  const pr = st.practice
  if (pr.loopStep !== 0) {
    const tgt = pr.loopTarget / 100
    let t = st.tempo + pr.loopStep / 100
    if (pr.loopStep > 0) {
      t = Math.min(t, Math.max(tgt, st.tempo))
    } else {
      t = Math.max(t, Math.min(tgt, st.tempo))
    }
    if (Math.abs(t - st.tempo) > 1e-6) {
      knob_set(app.ui.k_tempo, t * 100, true)
      view_toast('テンポ ' + String(Math.round(st.tempo * 1000) / 10) + '%', false)
    }
  }
  if (pr.loopCount > 0 && app.loop_n >= pr.loopCount && !app.loop_released) {
    app.loop_released = true
    eng_clear_loop(app.eng)
    view_toast(String(pr.loopCount) + '回ループしたので先へ進みます', false)
  }
}

function cycle_loop_mode(app: app_t): void {
  const order: loop_mode_t[] = [LOOP_NONE, LOOP_SINGLE, LOOP_AB, LOOP_MARK, LOOP_ALL]
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
    view_toast('波形をドラッグするか [ ] キーでA-B区間を指定してください', false)
  }
  if (app.st.loopMode === LOOP_MARK && !(app.st.loopEnd > app.st.loopStart)) {
    view_toast('◆ ボタンか M キーでマーカーを置くと、マーカーの間をループします', false)
  }
  view_loop_btn(app.refs, app.st.loopMode)
  save_state(app)
}

function cycle_play_mode(app: app_t): void {
  const order: play_mode_t[] = [PLAY_SEQ, PLAY_SHUFFLE, PLAY_REPEAT1, PLAY_REPEATALL]
  const i = order.indexOf(app.st.playMode)
  app.st.playMode = order[(i + 1) % order.length] ?? PLAY_SEQ
  app.pl.play_mode = app.st.playMode
  view_play_mode_btn(app.refs, app.st.playMode)
  save_state(app)
}

function toggle_reverse(app: app_t): void {
  app.st.reverse = !app.st.reverse
  sync_engine(app)
  wf_set_mirrored(app.ui.wf, app.st.reverse)
  if (app.cur_meta) {
    apply_track_loop(app, app.cur_meta)
  }
  view_toggle(app.refs, 'btn_reverse', app.st.reverse)
  save_state(app)
}

function on_engine_event(app: app_t, ev: eng_event_t): void {
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
      if (app.cur_meta?.pos !== undefined) {
        delete app.cur_meta.pos
        void db_put_track_meta(app.db, app.cur_meta)
      }
      handle_ended(app)
      break
    case 'loop':
      on_loop_event(app)
      break
    case 'loaded':
      view_time_total(app.refs, ev.duration)
      break
    case 'peaks':
      if (ev.job === app.ana_job) {
        wf_set_peaks(app.ui.wf, ev.mx, ev.mn)
      }
      break
    case 'info': {
      if (ev.job !== app.ana_job || app.ana_track_id === null) {
        break
      }
      const target = app.metas.get(app.ana_track_id)
      if (!target) {
        break
      }
      target.lufs = ev.lufs
      target.peak = ev.peak
      if (ev.bpm > 0) {
        target.bpm = ev.bpm
        target.beat = ev.beat
      }
      if (ev.key >= 0) {
        target.key = ev.key
      }
      void db_put_track_meta(app.db, target)
      if (app.cur_meta && app.cur_meta.id === target.id) {
        app.st.bpm = target.bpm ?? 0
        sync_engine(app)
        sync_beats(app)
        sync_info_chips(app)
        save_state(app)
      }
      break
    }
  }
}

function ms_update_metadata(meta: track_meta_t): void {
  if (!('mediaSession' in navigator)) {
    return
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.name,
    artist: '黙々ノロえもん',
  })
}

function ms_update_position(app: app_t): void {
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
      playbackRate: app.st.tempo * app.st.rate,
      position: clamp(app.pos_cur, 0, app.pos_total),
    })
  } catch {}
}

function ms_init(app: app_t): void {
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
      do_seek(app, Math.max(0, app.last_pos - (d.seekOffset ?? 10)))
    })
    ms.setActionHandler('seekforward', (d) => {
      do_seek(app, app.last_pos + (d.seekOffset ?? 10))
    })
    ms.setActionHandler('seekto', (d) => {
      if (typeof d.seekTime === 'number') {
        do_seek(app, d.seekTime)
      }
    })
  } catch {}
}

async function export_channels(app: app_t): Promise<{ ch: Float32Array[]; sr: number } | null> {
  const meta = app.cur_meta
  if (!meta || !app.cur_audio) {
    return null
  }
  if (app.sep.active.length > 0) {
    const g = stem_gains(app)
    let unity = true
    for (const v of g) {
      if (v !== 1) {
        unity = false
      }
    }
    if (!unity) {
      const sd = await db_stems_load(app.db, meta.id)
      if (sd) {
        const len = sd.meta.len
        const l = new Float32Array(len)
        const r = new Float32Array(len)
        for (let s = 0; s < sd.meta.n; s++) {
          const name = sd.meta.sources[s] ?? ''
          const idx = app.sep.active.indexOf(name)
          const gv = idx >= 0 ? (g[idx] ?? 0) : 0
          if (gv === 0) {
            continue
          }
          for (let c = 0; c < 2; c++) {
            const d = sd.data[s * 2 + c]
            const sc = sd.scale[s * 2 + c]
            const o = c === 0 ? l : r
            if (!d || !sc) {
              continue
            }
            for (let i = 0; i < len; i++) {
              o[i] = (o[i] ?? 0) + (d[i] ?? 0) * (sc[i >> 10] ?? 0) * gv
            }
          }
        }
        return { ch: [l, r], sr: 44100 }
      }
    }
  }
  const decoded = await eng_decode(app.eng, app.cur_audio.slice(0))
  const ch: Float32Array[] = []
  for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c++) {
    ch.push(decoded.getChannelData(c))
  }
  return { ch, sr: decoded.sampleRate }
}

async function export_wav(app: app_t): Promise<void> {
  const meta = app.cur_meta
  if (!app.cur_audio || !meta || app.exporting) {
    if (!meta) {
      view_toast('エクスポートする曲がありません', true)
    }
    return
  }
  let start = 0
  let end = meta.duration
  let suffix = ''
  const ab = app.st.loopMode === LOOP_AB || app.st.loopMode === LOOP_MARK
  if (ab && app.st.loopEnd > app.st.loopStart) {
    if (view_confirm('ループ区間だけ書き出しますか？\n（キャンセルで曲全体）')) {
      start = app.st.loopStart
      end = app.st.loopEnd
      suffix = ' (' + fmt_short(start) + '-' + fmt_short(end) + ')'
    }
  }
  const out_sec = (end - start) / (app.st.tempo * app.st.rate)
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
  view_export_busy(app.refs, true, '準備中…')
  try {
    const src = await export_channels(app)
    if (!src) {
      throw new Error('no source')
    }
    const m = eff_mix(app, true)
    const rendered = await eng_render_offline({ ch: src.ch, sr: src.sr, start, end }, m, (t) => {
      view_export_busy(app.refs, true, String(Math.round(t * 100)) + '%')
    })
    const tag =
      app.st.practice.special !== SP_NONE ? ' [' + special_name(app.st.practice.special) + ']' : ''
    wav_download(rendered, meta.name + suffix + tag, app.settings.exportFmt)
    view_toast('WAVを書き出しました', false)
  } catch {
    view_toast('エクスポートに失敗しました', true)
  } finally {
    app.exporting = false
    view_export_busy(app.refs, false, '')
  }
}

function special_name(id: special_t): string {
  return SPECIALS.find((x) => x.id === id)?.name ?? ''
}

function sep_status_idle(app: app_t): string {
  const m = app.cur_meta
  if (!m) {
    return '曲を選ぶと、ボーカル・ドラム・ベース・ギター・ピアノ・その他に分けられます。'
  }
  if (app.sep.active.length > 0) {
    return '分離済み。各パートの音量を変えたり、ミュート (M)・ソロ (S) できます。'
  }
  if (m.stems) {
    return '分離結果を読み込み中…'
  }
  return '「分離する」でAIが楽器ごとに分けます（初回はモデル約130MBを取得し、端末に保存します）。'
}

function sep_refresh(app: app_t): void {
  const ui = app.ui
  if (!app.sep.busy) {
    sep_view_status(ui.sep, sep_status_idle(app))
    sep_view_progress(ui.sep, null)
  }
  sep_view_run_btn(app.refs, app.sep.busy)
  const rows: stem_row_view_t[] = []
  const act = app.sep.active
  const order = [...act].sort((a, b) => {
    const ia = STEM_ORDER.indexOf(a)
    const ib = STEM_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  for (const n of order) {
    const m = stem_mix(app, n)
    rows.push({ name: n, gain: m.gain, mute: m.mute, solo: m.solo })
  }
  sep_view_stems(ui.sep, rows, {
    on_gain: (name, v): void => {
      stem_mix(app, name).gain = v
      sync_stems(app)
      save_state(app)
    },
    on_mute: (name): void => {
      const m = stem_mix(app, name)
      m.mute = !m.mute
      sync_stems(app)
      sep_refresh(app)
      save_state(app)
    },
    on_solo: (name): void => {
      const m = stem_mix(app, name)
      m.solo = !m.solo
      sync_stems(app)
      sep_refresh(app)
      save_state(app)
    },
  })
}

function stems_apply(
  app: app_t,
  meta: stems_meta_t,
  data: Int16Array[],
  scale: Float32Array[],
  tr: ArrayBuffer[],
): void {
  app.sep.active = [...meta.sources]
  eng_stems(app.eng, meta.n, data, scale, tr)
  sync_stems(app)
  sep_refresh(app)
}

async function stems_restore(app: app_t, m: track_meta_t): Promise<void> {
  const id = m.id
  const sd = await db_stems_load(app.db, id)
  if (!app.cur_meta || app.cur_meta.id !== id) {
    return
  }
  if (!sd) {
    delete m.stems
    void db_put_track_meta(app.db, m)
    sep_refresh(app)
    return
  }
  stems_apply(app, sd.meta, sd.data, sd.scale, sd.buffers)
}

function sep_worker(app: app_t): Worker {
  const sp = app.sep
  if (sp.w) {
    return sp.w
  }
  const w = new Worker(SEP_URL, { type: 'module' })
  sp.w = w
  sp.inited = false
  sp.ready = false
  w.onmessage = (ev: MessageEvent<unknown>): void => sep_on_msg(app, ev.data)
  w.onerror = (): void => {
    sep_fail(app, 'AI分離の処理でエラーが起きました')
  }
  w.postMessage({
    type: 'init',
    base: new URL(VENDOR_ORT, location.href).href,
    backend: app.settings.aiBackend,
  })
  return w
}

function sep_fail(app: app_t, msg: string): void {
  const sp = app.sep
  sp.busy = false
  if (sp.wait) {
    const f = sp.wait
    sp.wait = null
    f(false)
  }
  sep_view_status(app.ui.sep, msg)
  sep_view_progress(app.ui.sep, null)
  sep_view_run_btn(app.refs, false)
  view_toast(msg, true)
}

function sep_on_msg(app: app_t, d: unknown): void {
  if (!is_rec(d)) {
    return
  }
  const sp = app.sep
  const t = str_or(field(d, 'type'), '')
  switch (t) {
    case 'inited':
      sp.inited = true
      break
    case 'status':
      if (sp.busy) {
        sep_view_status(app.ui.sep, str_or(field(d, 'text'), ''))
      }
      break
    case 'progress': {
      const stage = str_or(field(d, 'stage'), '')
      const done = num_or(field(d, 'done'), 0)
      const total = num_or(field(d, 'total'), 0)
      if (stage === 'download') {
        const frac = total > 0 ? done / total : 0
        sep_view_progress(app.ui.sep, frac)
        sep_view_status(
          app.ui.sep,
          'モデルをダウンロード中… ' +
            (done / 1048576).toFixed(0) +
            (total > 0 ? ' / ' + (total / 1048576).toFixed(0) : '') +
            ' MB',
        )
      } else if (stage === 'separate' && num_or(field(d, 'job'), -1) === sp.job) {
        const el = num_or(field(d, 'elapsed'), 0)
        const frac = total > 0 ? done / total : 0
        const remain = frac > 0 ? (el / frac) * (1 - frac) : 0
        sep_view_progress(app.ui.sep, frac)
        sep_view_status(
          app.ui.sep,
          '分離中… ' +
            String(Math.round(frac * 100)) +
            '%' +
            (done >= 1 && remain > 1 ? '（残り約 ' + fmt_eta(remain) + '）' : '') +
            ' / ' +
            (sp.backend === 'webgpu' ? 'GPU' : 'CPU'),
        )
      }
      break
    }
    case 'ready': {
      sp.ready = true
      sp.model = str_or(field(d, 'name'), '')
      sp.backend = str_or(field(d, 'backend'), '')
      if (sp.wait) {
        const f = sp.wait
        sp.wait = null
        f(true)
      }
      break
    }
    case 'done':
      void sep_done(app, d)
      break
    case 'error':
      sep_fail(app, 'AI分離に失敗しました: ' + str_or(field(d, 'message'), ''))
      break
    case 'cleared':
      view_toast('モデルのキャッシュを削除しました', false)
      break
  }
}

function fmt_eta(sec: number): string {
  if (sec < 60) {
    return String(Math.ceil(sec)) + '秒'
  }
  return String(Math.ceil(sec / 60)) + '分'
}

async function sep_done(app: app_t, d: object): Promise<void> {
  const sp = app.sep
  const job = num_or(field(d, 'job'), -1)
  if (job !== sp.job) {
    return
  }
  const n = num_or(field(d, 'n'), 0)
  const len = num_or(field(d, 'len'), 0)
  const src_v = field(d, 'sources')
  const data_v = field(d, 'data')
  const scale_v = field(d, 'scale')
  const sources: string[] = []
  const data: Int16Array[] = []
  const scale: Float32Array[] = []
  if (Array.isArray(src_v)) {
    for (const s of src_v) {
      if (typeof s === 'string') {
        sources.push(s)
      }
    }
  }
  if (Array.isArray(data_v)) {
    for (const x of data_v) {
      if (x instanceof Int16Array) {
        data.push(x)
      }
    }
  }
  if (Array.isArray(scale_v)) {
    for (const x of scale_v) {
      if (x instanceof Float32Array) {
        scale.push(x)
      }
    }
  }
  sp.busy = false
  sep_view_run_btn(app.refs, false)
  if (n <= 0 || sources.length !== n || data.length !== n * 2 || scale.length !== n * 2) {
    sep_fail(app, 'AI分離の結果が壊れています')
    return
  }
  const el = (performance.now() - sp.t0) / 1000
  const tid = sp.track_id
  const meta = tid ? app.metas.get(tid) : undefined
  const sm: stems_meta_t = { model: sp.model, sources, n, len }
  if (meta) {
    sep_view_status(app.ui.sep, '分離結果を保存中…')
    const ok = await db_stems_save(app.db, meta.id, sm, data, scale)
    if (ok) {
      meta.stems = sm
      void db_put_track_meta(app.db, meta)
    }
  }
  if (app.cur_meta && tid === app.cur_meta.id) {
    const tr: ArrayBuffer[] = []
    for (const x of [...data, ...scale]) {
      if (x.buffer instanceof ArrayBuffer && !tr.includes(x.buffer)) {
        tr.push(x.buffer)
      }
    }
    stems_apply(app, sm, data, scale, tr)
    view_toast('分離が完了しました（' + fmt_eta(el) + '）', false)
  } else {
    sep_refresh(app)
  }
}

function sep_model_ensure(app: app_t): Promise<boolean> {
  const sp = app.sep
  const w = sep_worker(app)
  if (sp.ready) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    sp.wait = resolve
    w.postMessage({
      type: 'model',
      url: new URL(app.settings.aiModel, location.href).href,
      file: sp.file,
    })
  })
}

function sep_cancel(app: app_t): void {
  const sp = app.sep
  if (sp.w) {
    sp.w.terminate()
    sp.w = null
  }
  sp.busy = false
  sp.ready = false
  sp.inited = false
  if (sp.wait) {
    const f = sp.wait
    sp.wait = null
    f(false)
  }
  sep_refresh(app)
  view_toast('AI分離を中止しました', false)
}

async function sep_run(app: app_t): Promise<void> {
  const sp = app.sep
  if (sp.busy) {
    sep_cancel(app)
    return
  }
  const meta = app.cur_meta
  if (!meta || !app.cur_audio) {
    view_toast('先に曲を選んでください', true)
    return
  }
  if (app.sep.active.length > 0) {
    view_toast('この曲は分離済みです', false)
    return
  }
  if (meta.stems) {
    await stems_restore(app, meta)
    if (app.sep.active.length > 0) {
      return
    }
  }
  sp.busy = true
  sp.job++
  sp.track_id = meta.id
  sp.t0 = performance.now()
  sep_view_run_btn(app.refs, true)
  sep_view_status(app.ui.sep, '準備中…')
  sep_view_progress(app.ui.sep, 0)
  const ok = await sep_model_ensure(app)
  if (!ok || !sp.busy || !sp.w) {
    return
  }
  const audio = app.cur_audio
  if (!audio || !app.cur_meta || app.cur_meta.id !== sp.track_id) {
    sep_fail(app, '曲が切り替わったので中止しました')
    return
  }
  sep_view_status(app.ui.sep, '音声を準備中…')
  let ab: AudioBuffer
  try {
    ab = await eng_decode_at(audio.slice(0), 44100)
  } catch {
    sep_fail(app, '音声を読み込めませんでした')
    return
  }
  const ch: Float32Array[] = []
  for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) {
    ch.push(ab.getChannelData(c).slice())
  }
  if (ch.length === 1) {
    const c0 = ch[0]
    if (c0) {
      ch.push(c0.slice())
    }
  }
  const tr: ArrayBuffer[] = []
  for (const x of ch) {
    if (x.buffer instanceof ArrayBuffer) {
      tr.push(x.buffer)
    }
  }
  if (
    ab.length !== Math.round(meta.duration * 44100) &&
    Math.abs(ab.duration - app.eng.duration) > 0.05
  ) {
    sep_fail(app, 'この端末のサンプルレートでは分離結果を再生できません')
    return
  }
  sp.w.postMessage(
    { type: 'run', ch, sr: 44100, job: sp.job, overlap: app.settings.aiHq ? 0.5 : 0.25 },
    tr,
  )
}

async function sep_export(app: app_t): Promise<void> {
  const meta = app.cur_meta
  if (!meta || app.exporting) {
    return
  }
  const sd = await db_stems_load(app.db, meta.id)
  if (!sd) {
    view_toast('分離結果が見つかりません', true)
    return
  }
  app.exporting = true
  try {
    const len = sd.meta.len
    for (let s = 0; s < sd.meta.n; s++) {
      const name = sd.meta.sources[s] ?? 'stem'
      const ch: Float32Array[] = []
      for (let c = 0; c < 2; c++) {
        const d = sd.data[s * 2 + c]
        const sc = sd.scale[s * 2 + c]
        const o = new Float32Array(len)
        if (d && sc) {
          for (let i = 0; i < len; i++) {
            o[i] = (d[i] ?? 0) * (sc[i >> 10] ?? 0)
          }
        }
        ch.push(o)
      }
      const wav = wav_encode_planar(ch, 44100, app.settings.exportFmt)
      file_download(wav, meta.name + ' - ' + (STEM_NAMES[name] ?? name) + '.wav', 'audio/wav')
      await new Promise((r) => window.setTimeout(r, 700))
    }
    view_toast(String(sd.meta.n) + 'パートを書き出しました', false)
  } finally {
    app.exporting = false
  }
}

async function sep_clear(app: app_t): Promise<void> {
  const meta = app.cur_meta
  if (!meta || app.sep.active.length === 0) {
    return
  }
  if (
    !view_confirm(
      '分離結果を削除して元の音源に戻しますか？\n（もう一度分離するには時間がかかります）',
    )
  ) {
    return
  }
  eng_stems_clear(app.eng)
  app.sep.active = []
  delete meta.stems
  await db_stems_delete(app.db, meta.id)
  void db_put_track_meta(app.db, meta)
  sep_refresh(app)
}

function ai_pick_model(app: app_t): void {
  view_pick_files('.onnx,.ort', (files) => {
    const f = files[0]
    if (!f) {
      return
    }
    app.sep.file = f
    if (app.sep.w) {
      app.sep.w.terminate()
      app.sep.w = null
    }
    app.sep.ready = false
    view_toast('モデル「' + f.name + '」を使います', false)
  })
}

function ai_clear_cache(app: app_t): void {
  if (!view_confirm('ダウンロード済みのAIモデルを端末から削除しますか？')) {
    return
  }
  const w = sep_worker(app)
  app.sep.ready = false
  w.postMessage({ type: 'clear' })
}

function ear_tick(app: app_t): void {
  const g: number[] = []
  for (let i = 0; i < EQ_BANDS.length; i++) {
    g.push(Math.round((Math.random() * 24 - 12) * 2) / 2)
  }
  app.ear_eq = g
  app.ear_pan = Math.round((Math.random() * 2 - 1) * 100) / 100
  sync_engine(app)
}

function set_special(app: app_t, id: special_t): void {
  app.st.practice.special = id
  if (app.ear_timer !== 0) {
    clearInterval(app.ear_timer)
    app.ear_timer = 0
  }
  app.ear_eq = null
  app.ear_pan = 0
  if (id === SP_EAR) {
    ear_tick(app)
    app.ear_timer = window.setInterval(() => ear_tick(app), 3000)
    view_toast('3秒ごとに音質が変わります。どの帯域が変わったか聞き分けましょう', false)
  } else if (id === SP_BASS) {
    view_toast(
      app.sep.active.includes('bass')
        ? 'ベースだけを1オクターブ上げて聞き取りやすくしました'
        : '1オクターブ上げて低音を強調。AI分離するとベースだけを聞けます',
      false,
    )
  }
  app.refs.special_select.value = id
  sync_engine(app)
  sync_stems(app)
  sync_info_chips(app)
  save_state(app)
}

const DELAY_PRESETS: readonly {
  name: string
  time: number
  fb: number
  mix: number
  pp: boolean
  damp: number
}[] = [
  { name: '短いエコー', time: 120, fb: 0.25, mix: 0.35, pp: false, damp: 0.3 },
  { name: '中ぐらいのエコー', time: 250, fb: 0.35, mix: 0.35, pp: false, damp: 0.3 },
  { name: '長いエコー', time: 500, fb: 0.4, mix: 0.35, pp: false, damp: 0.35 },
  { name: 'ステレオの短いエコー', time: 120, fb: 0.3, mix: 0.4, pp: true, damp: 0.3 },
  { name: 'ステレオの中ぐらいのエコー', time: 250, fb: 0.4, mix: 0.4, pp: true, damp: 0.3 },
  { name: 'ステレオの長いエコー', time: 500, fb: 0.45, mix: 0.4, pp: true, damp: 0.35 },
  { name: '山びこ', time: 900, fb: 0.45, mix: 0.45, pp: true, damp: 0.6 },
  { name: '大きいエコー', time: 400, fb: 0.62, mix: 0.45, pp: false, damp: 0.25 },
  { name: 'ダブリング', time: 25, fb: 0, mix: 0.5, pp: false, damp: 0 },
  { name: 'ダブルキック', time: 70, fb: 0, mix: 0.6, pp: false, damp: 0 },
]

const PRESET_KEYS: readonly string[] = [
  'pitch',
  'tempo',
  'rate',
  'eqGains',
  'reverb',
  'reverbType',
  'bitcrusherBits',
  'bitcrusherReduction',
  'bitcrusherEnabled',
  'vocalCancel',
  'formant',
  'normalize',
  'limiter',
  'chMode',
  'pan',
  'width',
  'mod',
  'comp',
  'delay',
  'dist',
]

function presets_load(): preset_t[] {
  const v = json_read('wf-presets')
  const out: preset_t[] = []
  if (Array.isArray(v)) {
    for (const x of v) {
      if (is_rec(x)) {
        const name = field(x, 'name')
        const data = field(x, 'data')
        if (typeof name === 'string' && is_rec(data)) {
          const rec: Record<string, unknown> = {}
          for (const k of Object.keys(data)) {
            rec[k] = field(data, k)
          }
          out.push({ name, data: rec })
        }
      }
    }
  }
  return out
}

function presets_save(app: app_t): void {
  try {
    localStorage.setItem('wf-presets', JSON.stringify(app.presets))
  } catch {}
}

function presets_render(app: app_t): void {
  const sel = app.refs.preset_select
  view_fill_select(
    sel,
    'プリセット',
    app.presets.map((p) => p.name),
  )
  for (const opt of Array.from(sel.options)) {
    if (opt.value !== '') {
      opt.value = 'p:' + opt.value
    }
  }
  const add = document.createElement('option')
  add.value = '__save'
  add.textContent = '＋ 今の設定を保存…'
  sel.appendChild(add)
  if (app.presets.length > 0) {
    const del = document.createElement('option')
    del.value = '__del'
    del.textContent = '− プリセットを削除…'
    sel.appendChild(del)
  }
  sel.value = ''
}

function state_snapshot(app: app_t): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const raw: unknown = JSON.parse(JSON.stringify(app.st))
  if (is_rec(raw)) {
    for (const k of PRESET_KEYS) {
      out[k] = field(raw, k)
    }
  }
  return out
}

function state_restore(app: app_t, data: object): void {
  const base = default_state()
  const cur = app.st
  const merged: player_state_t = {
    ...cur,
    mod: { ...cur.mod },
    comp: { ...cur.comp },
    delay: { ...cur.delay },
    dist: { ...cur.dist },
    eqGains: [...cur.eqGains],
  }
  state_merge(merged, data, false)
  void base
  Object.assign(app.st, merged)
  sync_widgets(app)
  sync_engine(app)
  sync_info_chips(app)
  wf_set_mirrored(app.ui.wf, app.st.reverse)
  save_state(app)
}

function on_preset(app: app_t, v: string): void {
  if (v === '__save') {
    const name = view_prompt('プリセット名', 'プリセット ' + String(app.presets.length + 1))
    if (name === null || name.trim() === '') {
      return
    }
    const n = name.trim()
    app.presets = app.presets.filter((p) => p.name !== n)
    app.presets.push({ name: n, data: state_snapshot(app) })
    presets_save(app)
    presets_render(app)
    view_toast('「' + n + '」を保存しました', false)
    return
  }
  if (v === '__del') {
    const name = view_prompt(
      '削除するプリセット名\n' + app.presets.map((p) => '・' + p.name).join('\n'),
      app.presets[app.presets.length - 1]?.name ?? '',
    )
    if (name === null) {
      return
    }
    const before = app.presets.length
    app.presets = app.presets.filter((p) => p.name !== name.trim())
    if (app.presets.length !== before) {
      presets_save(app)
      presets_render(app)
      view_toast('削除しました', false)
    }
    return
  }
  if (v.startsWith('p:')) {
    const p = app.presets.find((x) => x.name === v.slice(2))
    if (p) {
      state_restore(app, p.data)
      view_toast('「' + p.name + '」を適用しました', false)
    }
  }
}

function reset_all(app: app_t): void {
  if (!view_confirm('ピッチ・テンポ・エフェクトをすべて初期値に戻しますか？')) {
    return
  }
  const d = default_state()
  const data: Record<string, unknown> = {}
  const raw: unknown = JSON.parse(JSON.stringify(d))
  if (is_rec(raw)) {
    for (const k of PRESET_KEYS) {
      data[k] = field(raw, k)
    }
  }
  state_restore(app, data)
  app.st.practice = { ...default_practice(), loopCount: app.st.practice.loopCount }
  set_special(app, SP_NONE)
  sync_widgets(app)
  sync_beats(app)
  view_toast('初期値に戻しました', false)
}

function set_sleep(app: app_t, min: number): void {
  app.sleep_min = min
  if (app.sleep_timer !== 0) {
    clearTimeout(app.sleep_timer)
    app.sleep_timer = 0
  }
  if (min <= 0) {
    return
  }
  app.sleep_timer = window.setTimeout(() => {
    app.sleep_timer = 0
    app.sleep_min = 0
    if (!app.playing) {
      return
    }
    void eng_fade(app.eng, 0, 8).then(() => {
      eng_pause(app.eng)
      app.playing = false
      vz_set_playing(app.ui.vz, false)
      view_play_btn(app.refs, false)
      remember_pos(app)
      window.setTimeout(() => void eng_fade(app.eng, 1, 0.01), 300)
    })
  }, min * 60000)
  view_toast(String(min) + '分後にフェードアウトして止めます', false)
}

function open_settings(app: app_t): void {
  const sp = app.sep
  const info = sp.ready
    ? 'モデル: ' +
      sp.model +
      ' / ' +
      (sp.backend === 'webgpu' ? 'GPU' : 'CPU') +
      '（並列: ' +
      (window.crossOriginIsolated ? '有効' : '無効') +
      '）'
    : sp.file
      ? 'モデル: ' + sp.file.name + '（未読み込み）'
      : 'モデル: ' + app.settings.aiModel
  const modal = view_settings_toggle(
    {
      theme: app.settings.theme,
      formant_def: app.settings.formantDef,
      bpm_auto: app.settings.bpmAuto,
      viz_mode: app.ui.vz.mode,
      export_fmt: app.settings.exportFmt,
      fade_stop: app.settings.fadeStop,
      sleep_min: app.sleep_min,
      resume: app.settings.resume,
      normalize: app.st.normalize,
      limiter: app.st.limiter,
      ai_backend: app.settings.aiBackend,
      ai_hq: app.settings.aiHq,
      ai_info: info,
    },
    {
      on_theme: (mode: theme_mode_t): void => {
        app.settings.theme = mode
        theme_apply(mode)
        save_settings(app)
      },
      on_formant_def: (on: boolean): void => {
        app.settings.formantDef = on
        save_settings(app)
      },
      on_bpm_auto: (on: boolean): void => {
        app.settings.bpmAuto = on
        save_settings(app)
      },
      on_viz_mode: (mode): void => {
        app.settings.vizMode = mode
        vz_set_mode(app.ui.vz, mode)
        save_settings(app)
      },
      on_export_fmt: (fmt): void => {
        app.settings.exportFmt = fmt
        save_settings(app)
      },
      on_fade_stop: (sec): void => {
        app.settings.fadeStop = clamp(sec, 0, 10)
        save_settings(app)
      },
      on_sleep: (min): void => set_sleep(app, min),
      on_resume: (on): void => {
        app.settings.resume = on
        save_settings(app)
      },
      on_normalize: (on): void => {
        app.st.normalize = on
        sync_engine(app)
        save_state(app)
        if (on && app.cur_meta && app.cur_meta.lufs === undefined) {
          view_toast('音量の測定が終わると反映されます', false)
        }
      },
      on_limiter: (on): void => {
        app.st.limiter = on
        sync_engine(app)
        save_state(app)
      },
      on_ai_backend: (b): void => {
        app.settings.aiBackend = b
        save_settings(app)
        if (app.sep.w && !app.sep.busy) {
          app.sep.w.terminate()
          app.sep.w = null
          app.sep.ready = false
        }
      },
      on_ai_hq: (on): void => {
        app.settings.aiHq = on
        save_settings(app)
      },
      on_ai_file: (): void => ai_pick_model(app),
      on_ai_clear: (): void => ai_clear_cache(app),
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

function cycle_theme(app: app_t): void {
  const order: theme_mode_t[] = [THEME_AUTO, THEME_LIGHT, THEME_DARK]
  const i = order.indexOf(app.settings.theme)
  const next = order[(i + 1) % order.length] ?? THEME_AUTO
  app.settings.theme = next
  theme_apply(next)
  save_settings(app)
  const names: Record<theme_mode_t, string> = {
    [THEME_AUTO]: 'テーマ: 自動',
    [THEME_LIGHT]: 'テーマ: ライト',
    [THEME_DARK]: 'テーマ: ダーク',
  }
  view_toast(names[next], false)
}

function set_view(app: app_t, v: mobile_view_t): void {
  app.view = v
  view_set_view(app.refs, v)
}

function toggle_flag(app: app_t, key: Parameters<typeof view_toggle>[1], on: boolean): void {
  view_toggle(app.refs, key, on)
  sync_engine(app)
  save_state(app)
}

function make_handlers(app: app_t): wire_handlers_t {
  const st = app.st
  return {
    on_open: (): void => open_file_picker(app),
    on_play_toggle: (): void => play_toggle(app),
    on_stop: (): void => do_stop(app),
    on_prev: (): void => do_prev(app),
    on_next: (): void => do_next(app),
    on_loop_cycle: (): void => cycle_loop_mode(app),
    on_play_mode_cycle: (): void => cycle_play_mode(app),
    on_ab_clear: (): void => {
      st.loopMode = LOOP_NONE
      st.loopStart = 0
      st.loopEnd = 0
      eng_clear_loop(app.eng)
      wf_clear_loop(app.ui.wf)
      view_loop_btn(app.refs, st.loopMode)
      save_state(app)
      if (app.cur_meta && app.cur_meta.abLoop) {
        delete app.cur_meta.abLoop
        void persist_meta(app, app.cur_meta)
      }
    },
    on_set_a: (): void => set_a_here(app),
    on_set_b: (): void => set_b_here(app),
    on_marker_add: (): void => marker_add(app),
    on_marker_step: (dir: number): void => marker_step(app, dir),
    on_vocal: (): void => {
      st.vocalCancel = !st.vocalCancel
      toggle_flag(app, 'btn_vocal', st.vocalCancel)
    },
    on_reverse: (): void => toggle_reverse(app),
    on_bc: (): void => {
      st.bitcrusherEnabled = !st.bitcrusherEnabled
      toggle_flag(app, 'btn_bc_toggle', st.bitcrusherEnabled)
    },
    on_formant: (): void => {
      st.formant = !st.formant
      toggle_flag(app, 'btn_formant', st.formant)
    },
    on_mod: (): void => {
      st.mod.en = !st.mod.en
      toggle_flag(app, 'btn_mod_toggle', st.mod.en)
    },
    on_comp: (): void => {
      st.comp.en = !st.comp.en
      toggle_flag(app, 'btn_comp_toggle', st.comp.en)
    },
    on_delay: (): void => {
      st.delay.en = !st.delay.en
      toggle_flag(app, 'btn_delay_toggle', st.delay.en)
    },
    on_delay_pp: (): void => {
      st.delay.pp = !st.delay.pp
      el_active(app.ui.b_dpp, st.delay.pp)
      sync_engine(app)
      save_state(app)
    },
    on_dist: (): void => {
      st.dist.en = !st.dist.en
      toggle_flag(app, 'btn_dist_toggle', st.dist.en)
    },
    on_click: (): void => {
      st.practice.click = !st.practice.click
      view_toggle(app.refs, 'btn_click', st.practice.click)
      if (st.practice.click && !((app.cur_meta?.bpm ?? 0) > 0)) {
        view_toast('BPMの検出が終わるとクリックが鳴ります', false)
      }
      sync_beats(app)
      save_state(app)
    },
    on_sep_run: (): void => {
      void sep_run(app)
    },
    on_sep_export: (): void => {
      void sep_export(app)
    },
    on_sep_clear: (): void => {
      void sep_clear(app)
    },
    on_export: (): void => {
      void export_wav(app)
    },
    on_settings: (): void => open_settings(app),
    on_theme: (): void => cycle_theme(app),
    on_mic: (): void => {
      void (async (): Promise<void> => {
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
    on_add_track: (): void => open_file_picker(app),
    on_add_playlist: (): void => {
      const name = 'プレイリスト ' + String(pl_all(app.pl).length + 1)
      void pl_create(app.pl, name).then(() => render_playlist(app))
    },
    on_nav: (v: mobile_view_t): void => set_view(app, v),
    on_eq_preset: (name: string): void => {
      const preset = EQ_PRESETS.find((pr) => pr.name === name)
      if (!preset) {
        return
      }
      st.eqGains = [...preset.bands]
      eq_bank_set(app.ui.eq, st.eqGains)
      sync_engine(app)
      save_state(app)
    },
    on_mod_mode: (value: string): void => {
      const mode: mod_mode_t =
        value === MOD_CHORUS
          ? MOD_CHORUS
          : value === MOD_PHASER
            ? MOD_PHASER
            : value === MOD_TREMOLO
              ? MOD_TREMOLO
              : MOD_FLANGER
      st.mod.mode = mode
      sync_engine(app)
      save_state(app)
    },
    on_reverb_type: (value: string): void => {
      if (REVERB_TYPES.some((x) => x.id === value)) {
        st.reverbType = value
        if (st.reverb === 0) {
          slider_set(app.ui.s_reverb, 30, true)
        }
        sync_engine(app)
        save_state(app)
      }
    },
    on_delay_preset: (name: string): void => {
      const p = DELAY_PRESETS.find((x) => x.name === name)
      if (!p) {
        return
      }
      st.delay = { time: p.time, fb: p.fb, mix: p.mix, pp: p.pp, damp: p.damp, en: true }
      sync_widgets(app)
      sync_engine(app)
      save_state(app)
    },
    on_ch_mode: (value: string): void => {
      st.chMode = clamp(Math.round(Number(value) || 0), 0, 4)
      sync_engine(app)
      save_state(app)
    },
    on_special: (value: string): void => {
      const sp = SPECIALS.find((x) => x.id === value)
      set_special(app, sp ? sp.id : SP_NONE)
    },
    on_preset: (value: string): void => on_preset(app, value),
    on_reset_all: (): void => reset_all(app),
    on_seek_delta: (sec: number): void => {
      do_seek(app, Math.max(0, app.last_pos + sec))
    },
    on_tempo_delta: (delta: number): void => {
      knob_set(app.ui.k_tempo, app.ui.k_tempo.value + delta, true)
    },
    on_pitch_delta: (delta: number): void => {
      knob_set(app.ui.k_pitch, app.ui.k_pitch.value + delta, true)
    },
    on_home: (): void => {
      do_seek(app, app.st.reverse && app.cur_meta ? app.cur_meta.duration : 0)
    },
    on_viz_click: (): void => {
      app.settings.vizMode = app.ui.vz.mode
      save_settings(app)
    },
    on_files: (files: File[]): void => import_files(app, files),
  }
}

function start_pitch_chip(app: app_t): void {
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

export async function app_init(): Promise<void> {
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

  if (st.practice.special !== SP_NONE) {
    st.practice.special = SP_NONE
  }
  const ui = view_controls_new(refs, st)
  vz_connect(ui.vz, eng.analyser)
  vz_set_mode(ui.vz, settings.vizMode)

  const app: app_t = {
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
    ana_job: 0,
    ana_track_id: null,
    exporting: false,
    last_pos: 0,
    pos_raf: false,
    pos_cur: 0,
    pos_total: 0,
    ms_pos_at: 0,
    view: 'player',
    loop_n: 0,
    loop_released: false,
    ear_eq: null,
    ear_pan: 0,
    ear_timer: 0,
    sleep_min: 0,
    sleep_timer: 0,
    save_timer: 0,
    fading: false,
    ended: false,
    sep: {
      w: null,
      inited: false,
      ready: false,
      busy: false,
      job: 0,
      track_id: null,
      model: '',
      backend: '',
      t0: 0,
      file: null,
      active: [],
      wait: null,
    },
    presets: presets_load(),
  }
  Object.seal(app)

  eng_on(eng, (ev: eng_event_t) => on_engine_event(app, ev))
  bind_widget_handlers(app)
  sync_widgets(app)
  sync_engine(app)
  view_play_btn(refs, false)
  view_loop_btn(refs, st.loopMode)
  view_play_mode_btn(refs, st.playMode)
  view_toggles(refs, st)
  view_wire(refs, ui, make_handlers(app))
  presets_render(app)
  view_fill_select(
    refs.delay_preset_select,
    '選んでください',
    DELAY_PRESETS.map((p) => p.name),
  )
  ms_init(app)
  set_view(app, 'player')
  start_pitch_chip(app)
  sep_refresh(app)

  eng.ctx.addEventListener('statechange', () => {
    if (eng.ctx.state === 'suspended' && app.playing) {
      app.playing = false
      vz_set_playing(ui.vz, false)
      view_play_btn(refs, false)
    }
  })
  on_visibility((hidden) => {
    if (hidden) {
      remember_pos(app)
      save_state_now(app)
    } else if (app.playing) {
      eng_resume(eng)
    }
  })
  window.addEventListener('pagehide', () => {
    remember_pos(app)
    save_state_now(app)
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
    await load_track(app, st.currentTrackId, false, true)
  }
  if (!app.cur_meta) {
    view_track_name(refs, '曲を選んでください', false)
  }
}
