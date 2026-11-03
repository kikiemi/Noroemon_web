export const LOOP_NONE = 'none'
export const LOOP_SINGLE = 'single'
export const LOOP_AB = 'ab'
export const LOOP_MARK = 'mark'
export const LOOP_ALL = 'all'
export type loop_mode_t =
  | typeof LOOP_NONE
  | typeof LOOP_SINGLE
  | typeof LOOP_AB
  | typeof LOOP_MARK
  | typeof LOOP_ALL

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
export const MOD_TREMOLO = 'tr'
export type mod_mode_t =
  | typeof MOD_FLANGER
  | typeof MOD_CHORUS
  | typeof MOD_PHASER
  | typeof MOD_TREMOLO

export const VIZ_BARS = 'bars'
export const VIZ_WAVE = 'wave'
export type viz_mode_t = typeof VIZ_BARS | typeof VIZ_WAVE

export const THEME_AUTO = 'auto'
export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'
export type theme_mode_t = typeof THEME_AUTO | typeof THEME_LIGHT | typeof THEME_DARK

export const SP_NONE = 'none'
export const SP_RECORD = 'record'
export const SP_BATTERY = 'battery'
export const SP_NOSENSE = 'nosense'
export const SP_BASS = 'bass'
export const SP_HIHAT = 'hihat'
export const SP_EAR = 'ear'
export type special_t =
  | typeof SP_NONE
  | typeof SP_RECORD
  | typeof SP_BATTERY
  | typeof SP_NOSENSE
  | typeof SP_BASS
  | typeof SP_HIHAT
  | typeof SP_EAR

export const SPECIALS: readonly { id: special_t; name: string }[] = [
  { id: SP_NONE, name: 'なし' },
  { id: SP_RECORD, name: '古びたレコード' },
  { id: SP_BATTERY, name: '電池切れ' },
  { id: SP_NOSENSE, name: '歌へたモード' },
  { id: SP_BASS, name: 'ベースの耳コピ' },
  { id: SP_HIHAT, name: 'ハイハットの耳コピ' },
  { id: SP_EAR, name: '聴覚トレーニング' },
]

export const REVERB_TYPES: readonly { id: string; name: string }[] = [
  { id: 'hall', name: 'ホール' },
  { id: 'room', name: '部屋' },
  { id: 'plate', name: 'プレート' },
  { id: 'church', name: '大聖堂' },
  { id: 'cave', name: '洞窟' },
]

export type ab_loop_t = {
  start: number
  end: number
}

export type stems_meta_t = {
  model: string
  sources: string[]
  n: number
  len: number
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
  beat?: number
  key?: number
  lufs?: number
  peak?: number
  markers?: number[]
  pos?: number
  stems?: stems_meta_t
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

export type delay_params_t = {
  time: number
  fb: number
  mix: number
  pp: boolean
  damp: number
  en: boolean
}

export type dist_params_t = {
  drive: number
  tone: number
  mix: number
  en: boolean
}

export type practice_t = {
  loopCount: number
  loopStep: number
  loopTarget: number
  special: special_t
  click: boolean
  clickVol: number
}

export type stem_mix_t = {
  gain: number
  mute: boolean
  solo: boolean
}

export type player_state_t = {
  currentTrackId: string | null
  currentPlaylistId: string | null
  volume: number
  pitch: number
  tempo: number
  rate: number
  eqGains: number[]
  loopMode: loop_mode_t
  loopStart: number
  loopEnd: number
  playMode: play_mode_t
  reverb: number
  reverbType: string
  bitcrusherBits: number
  bitcrusherReduction: number
  bitcrusherEnabled: boolean
  vocalCancel: boolean
  reverse: boolean
  formant: boolean
  normalize: boolean
  limiter: boolean
  chMode: number
  pan: number
  width: number
  mod: mod_params_t
  comp: comp_params_t
  delay: delay_params_t
  dist: dist_params_t
  practice: practice_t
  stems: Record<string, stem_mix_t>
  bpm: number
}

export const EXPORT_16 = 16
export const EXPORT_24 = 24
export const EXPORT_32F = 32
export type export_fmt_t = typeof EXPORT_16 | typeof EXPORT_24 | typeof EXPORT_32F

export const AI_AUTO = 'auto'
export const AI_WEBGPU = 'webgpu'
export const AI_WASM = 'wasm'
export type ai_backend_t = typeof AI_AUTO | typeof AI_WEBGPU | typeof AI_WASM

export type settings_t = {
  formantDef: boolean
  bpmAuto: boolean
  vizMode: viz_mode_t
  theme: theme_mode_t
  exportFmt: export_fmt_t
  fadeStop: number
  resume: boolean
  aiBackend: ai_backend_t
  aiHq: boolean
  aiModel: string
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
  { name: '低音強調（強）', bands: [0, 0, 0, -6, -12, -12, -12, -12, -12, -12] },
  { name: '低音強調（弱）', bands: [0, 0, 0, -3, -6, -6, -6, -6, -6, -6] },
  { name: '中音強調（強）', bands: [-12, -12, -12, -6, 0, 0, 0, -6, -12, -12] },
  { name: '中音強調（弱）', bands: [-6, -6, -6, -3, 0, 0, 0, -3, -6, -6] },
  { name: '高音強調（強）', bands: [-12, -12, -12, -12, -12, -12, -6, 0, 0, 0] },
  { name: '高音強調（弱）', bands: [-6, -6, -6, -6, -6, -6, -3, 0, 0, 0] },
  { name: '低音カット', bands: [-12, -12, -9, -4, 0, 0, 0, 0, 0, 0] },
  { name: '中音カット', bands: [0, 0, 0, -4, -10, -12, -10, -4, 0, 0] },
  { name: '高音カット', bands: [0, 0, 0, 0, 0, 0, -4, -9, -12, -12] },
  { name: '電話の声', bands: [-12, -12, -12, -6, 4, 6, 4, -6, -12, -12] },
]

export const PITCH_MIN = -24
export const PITCH_MAX = 24
export const TEMPO_MIN = 0.1
export const TEMPO_MAX = 4.0
export const RATE_MIN = 0.25
export const RATE_MAX = 4.0

export const STEM_ORDER: readonly string[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']
export const STEM_NAMES: Readonly<Record<string, string>> = {
  vocals: 'ボーカル',
  drums: 'ドラム',
  bass: 'ベース',
  guitar: 'ギター',
  piano: 'ピアノ',
  other: 'その他',
  accompaniment: '伴奏',
}

export const KEY_NAMES: readonly string[] = [
  'C',
  'C#',
  'D',
  'E♭',
  'E',
  'F',
  'F#',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
]

export function key_name(key: number, shift: number): string {
  if (!(key >= 0 && key < 24)) {
    return ''
  }
  const minor = key >= 12
  const root = ((((key % 12) + Math.round(shift)) % 12) + 12) % 12
  return (KEY_NAMES[root] ?? '') + (minor ? 'm' : '')
}

export function default_practice(): practice_t {
  return {
    loopCount: 0,
    loopStep: 0,
    loopTarget: 100,
    special: SP_NONE,
    click: false,
    clickVol: 0.5,
  }
}

export function default_state(): player_state_t {
  return {
    currentTrackId: null,
    currentPlaylistId: null,
    volume: 0.8,
    pitch: 0,
    tempo: 1.0,
    rate: 1.0,
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    loopMode: LOOP_NONE,
    loopStart: 0,
    loopEnd: 0,
    playMode: PLAY_SEQ,
    reverb: 0,
    reverbType: 'hall',
    bitcrusherBits: 16,
    bitcrusherReduction: 1,
    bitcrusherEnabled: false,
    vocalCancel: false,
    reverse: false,
    formant: true,
    normalize: false,
    limiter: true,
    chMode: 0,
    pan: 0,
    width: 1,
    mod: { mode: MOD_FLANGER, rate: 0.5, depth: 0.5, fb: 0.3, mix: 0.5, en: false },
    comp: { thr: -10, rat: 4, atk: 10, rel: 100, mkup: 0, en: false },
    delay: { time: 350, fb: 0.35, mix: 0.3, pp: false, damp: 0.3, en: false },
    dist: { drive: 12, tone: 0.6, mix: 1, en: false },
    practice: default_practice(),
    stems: {},
    bpm: 0,
  }
}

export function default_settings(): settings_t {
  return {
    formantDef: true,
    bpmAuto: true,
    vizMode: VIZ_BARS,
    theme: THEME_AUTO,
    exportFmt: EXPORT_16,
    fadeStop: 0,
    resume: true,
    aiBackend: AI_AUTO,
    aiHq: false,
    aiModel: './models/htdemucs_6s.json',
  }
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

export function is_rec(v: unknown): v is object {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function field(o: object, k: string): unknown {
  return Reflect.get(o, k)
}

export function num_or(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

export function bool_or(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d
}

export function str_or(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d
}
