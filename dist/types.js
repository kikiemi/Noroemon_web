export var LoopMode;
(function (LoopMode) {
    LoopMode["None"] = "none";
    LoopMode["Single"] = "single";
    LoopMode["All"] = "all";
    LoopMode["AB"] = "ab";
})(LoopMode || (LoopMode = {}));
export var PlayMode;
(function (PlayMode) {
    PlayMode["Sequential"] = "sequential";
    PlayMode["Shuffle"] = "shuffle";
    PlayMode["RepeatOne"] = "repeat-one";
    PlayMode["RepeatAll"] = "repeat-all";
})(PlayMode || (PlayMode = {}));
export var ModMode;
(function (ModMode) {
    ModMode["Fl"] = "fl";
    ModMode["Ch"] = "ch";
    ModMode["Ph"] = "ph";
})(ModMode || (ModMode = {}));
export var VizMode;
(function (VizMode) {
    VizMode["Bars"] = "bars";
    VizMode["Circ"] = "circ";
    VizMode["Cmb"] = "cmb";
})(VizMode || (VizMode = {}));
export const DEFAULT_EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = [
    { name: 'フラット', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: 'ロック', bands: [5, 4, 3, 1, 0, -1, 1, 3, 4, 5] },
    { name: 'ポップ', bands: [-1, 2, 4, 5, 3, 0, -1, 1, 2, 3] },
    { name: 'ジャズ', bands: [3, 2, 1, 2, 0, -1, -1, 1, 2, 3] },
    { name: 'クラシック', bands: [4, 3, 2, 1, 0, 0, 0, 1, 3, 4] },
    { name: 'ベースブースト', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
    { name: 'ボーカル強調', bands: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
    { name: 'EDM', bands: [5, 4, 2, 0, -2, -1, 1, 3, 4, 5] },
];
export const DEFAULT_STATE = {
    currentTrackId: null,
    currentPlaylistId: null,
    volume: 0.8,
    pitch: 0,
    tempo: 1.0,
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    loopMode: LoopMode.None,
    loopStart: 0,
    loopEnd: 0,
    playMode: PlayMode.Sequential,
    reverb: 0,
    bitcrusherBits: 16,
    bitcrusherReduction: 1,
    bitcrusherEnabled: false,
    vocalCancel: false,
    reverse: false,
    formant: true,
    mod: { mode: ModMode.Fl, rate: .5, depth: .5, fb: .3, mix: .5, en: false },
    comp: { thr: -10, rat: 4, atk: 10, rel: 100, mkup: 0, en: false },
    bpm: 0,
};
export const DEFAULT_SETTINGS = { formantDef: true, bpmAuto: true, vizMode: VizMode.Cmb, themeHue: 187 };
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}
//# sourceMappingURL=types.js.map