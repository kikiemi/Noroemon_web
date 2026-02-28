export interface TrackMeta {
  id: string;
  name: string;
  duration: number;
  sampleRate: number;
  channels: number;
  addedAt: number;
  size: number;
}

export interface PlaylistData {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}


export interface EQPreset {
  name: string;
  bands: number[];
}


export enum LoopMode {
  None = 'none',
  Single = 'single',
  All = 'all',
  AB = 'ab',
}

export enum PlayMode {
  Sequential = 'sequential',
  Shuffle = 'shuffle',
  RepeatOne = 'repeat-one',
  RepeatAll = 'repeat-all',
}

export enum ModMode{Fl='fl',Ch='ch',Ph='ph'}
export enum VizMode{Bars='bars',Circ='circ',Cmb='cmb'}
export interface ModState{mode:ModMode;rate:number;depth:number;fb:number;mix:number;en:boolean}
export interface CompState{thr:number;rat:number;atk:number;rel:number;mkup:number;en:boolean}
export interface Settings{formantDef:boolean;bpmAuto:boolean;vizMode:VizMode;themeHue:number}

export interface AppState {
  currentTrackId: string | null;
  currentPlaylistId: string | null;
  volume: number;
  pitch: number;        
  tempo: number;        
  eqGains: number[];    
  loopMode: LoopMode;
  loopStart: number;    
  loopEnd: number;      
  playMode: PlayMode;
  reverb: number;       
  bitcrusherBits: number;
  bitcrusherReduction: number;
  bitcrusherEnabled: boolean;
  vocalCancel: boolean;
  reverse: boolean;
  formant: boolean;
  mod: ModState;
  comp: CompState;
  bpm: number;
}


export const DEFAULT_EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_PRESETS: EQPreset[] = [
  { name: 'フラット',       bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'ロック',         bands: [5, 4, 3, 1, 0, -1, 1, 3, 4, 5] },
  { name: 'ポップ',         bands: [-1, 2, 4, 5, 3, 0, -1, 1, 2, 3] },
  { name: 'ジャズ',         bands: [3, 2, 1, 2, 0, -1, -1, 1, 2, 3] },
  { name: 'クラシック',     bands: [4, 3, 2, 1, 0, 0, 0, 1, 3, 4] },
  { name: 'ベースブースト', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { name: 'ボーカル強調',   bands: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: 'EDM',            bands: [5, 4, 2, 0, -2, -1, 1, 3, 4, 5] },
];

export const DEFAULT_STATE: AppState = {
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
  mod: {mode:ModMode.Fl,rate:.5,depth:.5,fb:.3,mix:.5,en:false},
  comp: {thr:-10,rat:4,atk:10,rel:100,mkup:0,en:false},
  bpm: 0,
};

export const DEFAULT_SETTINGS:Settings={formantDef:true,bpmAuto:true,vizMode:VizMode.Cmb,themeHue:187};


export type EngineEvent =
  | { type: 'position'; current: number; total: number }
  | { type: 'ended' }
  | { type: 'loaded'; duration: number }
  | { type: 'error'; message: string }
  | { type: 'bpm'; value: number };

export type EngineEventHandler = (event: EngineEvent) => void;


export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}
