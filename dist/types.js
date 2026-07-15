export const LOOP_NONE = 'none'
export const LOOP_SINGLE = 'single'
export const LOOP_AB = 'ab'
export const LOOP_ALL = 'all'
export const PLAY_SEQ = 'sequential'
export const PLAY_SHUFFLE = 'shuffle'
export const PLAY_REPEAT1 = 'repeat-one'
export const PLAY_REPEATALL = 'repeat-all'
export const MOD_FLANGER = 'fl'
export const MOD_CHORUS = 'ch'
export const MOD_PHASER = 'ph'
export const VIZ_BARS = 'bars'
export const VIZ_WAVE = 'wave'
export const THEME_AUTO = 'auto'
export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'
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
]
export const PITCH_MIN = -24
export const PITCH_MAX = 24
export const TEMPO_MIN = 0.25
export const TEMPO_MAX = 4.0
export function default_state() {
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
export function default_settings() {
  return { formantDef: true, bpmAuto: true, vizMode: VIZ_BARS, theme: THEME_AUTO }
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
