export const LOOP_NONE = 'none'
export const LOOP_SINGLE = 'single'
export const LOOP_AB = 'ab'
export const LOOP_MARK = 'mark'
export const LOOP_ALL = 'all'
export const PLAY_SEQ = 'sequential'
export const PLAY_SHUFFLE = 'shuffle'
export const PLAY_REPEAT1 = 'repeat-one'
export const PLAY_REPEATALL = 'repeat-all'
export const MOD_FLANGER = 'fl'
export const MOD_CHORUS = 'ch'
export const MOD_PHASER = 'ph'
export const MOD_TREMOLO = 'tr'
export const VIZ_BARS = 'bars'
export const VIZ_WAVE = 'wave'
export const THEME_AUTO = 'auto'
export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'
export const SP_NONE = 'none'
export const SP_RECORD = 'record'
export const SP_BATTERY = 'battery'
export const SP_NOSENSE = 'nosense'
export const SP_BASS = 'bass'
export const SP_HIHAT = 'hihat'
export const SP_EAR = 'ear'
export const SPECIALS = [
  { id: SP_NONE, name: 'なし' },
  { id: SP_RECORD, name: '古びたレコード' },
  { id: SP_BATTERY, name: '電池切れ' },
  { id: SP_NOSENSE, name: '歌へたモード' },
  { id: SP_BASS, name: 'ベースの耳コピ' },
  { id: SP_HIHAT, name: 'ハイハットの耳コピ' },
  { id: SP_EAR, name: '聴覚トレーニング' },
]
export const REVERB_TYPES = [
  { id: 'hall', name: 'ホール' },
  { id: 'room', name: '部屋' },
  { id: 'plate', name: 'プレート' },
  { id: 'church', name: '大聖堂' },
  { id: 'cave', name: '洞窟' },
]
export const EXPORT_16 = 16
export const EXPORT_24 = 24
export const EXPORT_32F = 32
export const AI_AUTO = 'auto'
export const AI_WEBGPU = 'webgpu'
export const AI_WASM = 'wasm'
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const EQ_PRESETS = [
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
export const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']
export const STEM_NAMES = {
  vocals: 'ボーカル',
  drums: 'ドラム',
  bass: 'ベース',
  guitar: 'ギター',
  piano: 'ピアノ',
  other: 'その他',
  accompaniment: '伴奏',
}
export const KEY_NAMES = ['C', 'C#', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B']
export function key_name(key, shift) {
  if (!(key >= 0 && key < 24)) {
    return ''
  }
  const minor = key >= 12
  const root = ((((key % 12) + Math.round(shift)) % 12) + 12) % 12
  return (KEY_NAMES[root] ?? '') + (minor ? 'm' : '')
}
export function default_practice() {
  return {
    loopCount: 0,
    loopStep: 0,
    loopTarget: 100,
    special: SP_NONE,
    click: false,
    clickVol: 0.5,
  }
}
export function default_state() {
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
export function default_settings() {
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
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}
export function gen_id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}
export function fmt_time(sec) {
  if (!Number.isFinite(sec) || sec < 0) {
    sec = 0
  }
  const m = (sec / 60) | 0
  const s = sec % 60 | 0
  const d = ((sec % 1) * 10) | 0
  return m + ':' + String(s).padStart(2, '0') + '.' + d
}
export function semis_to_ratio(semis) {
  return Math.pow(2, semis / 12)
}
export function is_rec(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
export function field(o, k) {
  return Reflect.get(o, k)
}
export function num_or(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}
export function bool_or(v, d) {
  return typeof v === 'boolean' ? v : d
}
export function str_or(v, d) {
  return typeof v === 'string' ? v : d
}
