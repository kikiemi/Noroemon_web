export const LOOP_NONE = 'none'
export const LOOP_SINGLE = 'single'
export const LOOP_AB = 'ab'
export const LOOP_ALL = 'all'
export type loop_mode_t = typeof LOOP_NONE | typeof LOOP_SINGLE | typeof LOOP_AB | typeof LOOP_ALL

export const PLAY_SEQ = 'sequential'
export const PLAY_SHUFFLE = 'shuffle'
export const PLAY_REPEAT1 = 'repeat-one'
export const PLAY_REPEATALL = 'repeat-all'
export type play_mode_t =
  | typeof PLAY_SEQ
  | typeof PLAY_SHUFFLE
  | typeof PLAY_REPEAT1
  | typeof PLAY_REPEATALL

export const MOD_FLANGER = 'fl'
export const MOD_CHORUS = 'ch'
export const MOD_PHASER = 'ph'
export type mod_mode_t = typeof MOD_FLANGER | typeof MOD_CHORUS | typeof MOD_PHASER

export const VIZ_BARS = 'bars'
export const VIZ_WAVE = 'wave'
export type viz_mode_t = typeof VIZ_BARS | typeof VIZ_WAVE

export const THEME_AUTO = 'auto'
export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'
export type theme_mode_t = typeof THEME_AUTO | typeof THEME_LIGHT | typeof THEME_DARK

export type ab_loop_t = {
  start: number
  end: number
}

export type track_meta_t = {
  id: string
  name: string
  duration: number
  sampleRate: number
  channels: number
  addedAt: number
  size: number
  abLoop?: ab_loop_t
  bpm?: number
}

export type playlist_t = {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
}

export type mod_params_t = {
  mode: mod_mode_t
  rate: number
  depth: number
  fb: number
  mix: number
  en: boolean
}

export type comp_params_t = {
  thr: number
  rat: number
  atk: number
  rel: number
  mkup: number
  en: boolean
}

export type player_state_t = {
  currentTrackId: string | null
  currentPlaylistId: string | null
  volume: number
  pitch: number
  tempo: number
  eqGains: number[]
  loopMode: loop_mode_t
  loopStart: number
  loopEnd: number
  playMode: play_mode_t
  reverb: number
  bitcrusherBits: number
  bitcrusherReduction: number
  bitcrusherEnabled: boolean
  vocalCancel: boolean
  reverse: boolean
  formant: boolean
  mod: mod_params_t
  comp: comp_params_t
  bpm: number
}

export type settings_t = {
  formantDef: boolean
  bpmAuto: boolean
  vizMode: viz_mode_t
  theme: theme_mode_t
}

export const EQ_BANDS: readonly number[] = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export type eq_preset_t = {
  name: string
  bands: readonly number[]
}
export const EQ_PRESETS: readonly eq_preset_t[] = [
  { name: 'フラット', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'ロック', bands: [5, 4, 3, 1, 0, -1, 1, 3, 4, 5] },
  { name: 'ポップ', bands: [-1, 2, 4, 5, 3, 0, -1, 1, 2, 3] },
  { name: 'ジャズ', bands: [3, 2, 1, 2, 0, -1, -1, 1, 2, 3] },
  { name: 'クラシック', bands: [4, 3, 2, 1, 0, 0, 0, 1, 3, 4] },
  { name: 'ベースブースト', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'ボーカル強調', bands: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: 'EDM', bands: [5, 4, 2, 0, -2, -1, 1, 3, 4, 5] },
]

export const PITCH_MIN = -24
export const PITCH_MAX = 24
export const TEMPO_MIN = 0.25
export const TEMPO_MAX = 4.0

export function default_state(): player_state_t {
  return {
    currentTrackId: null,
    currentPlaylistId: null,
    volume: 0.8,
    pitch: 0,
    tempo: 1.0,
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    loopMode: LOOP_NONE,
    loopStart: 0,
    loopEnd: 0,
    playMode: PLAY_SEQ,
    reverb: 0,
    bitcrusherBits: 16,
    bitcrusherReduction: 1,
    bitcrusherEnabled: false,
    vocalCancel: false,
    reverse: false,
    formant: true,
    mod: { mode: MOD_FLANGER, rate: 0.5, depth: 0.5, fb: 0.3, mix: 0.5, en: false },
    comp: { thr: -10, rat: 4, atk: 10, rel: 100, mkup: 0, en: false },
    bpm: 0,
  }
}

export function default_settings(): settings_t {
  return { formantDef: true, bpmAuto: true, vizMode: VIZ_BARS, theme: THEME_AUTO }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function gen_id(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}

export function fmt_time(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) {
    sec = 0
  }
  const m = (sec / 60) | 0
  const s = sec % 60 | 0
  const d = ((sec % 1) * 10) | 0
  return m + ':' + String(s).padStart(2, '0') + '.' + d
}

export function semis_to_ratio(semis: number): number {
  return Math.pow(2, semis / 12)
}
