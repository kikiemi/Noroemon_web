import { AudioEngine } from '../audio/engine.js';
import { downloadWAV } from '../audio/wav-encoder.js';
import { AudioDB } from '../storage/db.js';
import { PlaylistManager } from '../playlist/manager.js';
import {
  TrackMeta, PlayMode, LoopMode, AppState, DEFAULT_STATE,
  DEFAULT_EQ_BANDS, EQ_PRESETS, formatTime, clamp, EngineEvent,
  ModMode, Settings, DEFAULT_SETTINGS, VizMode,
} from '../types.js';
import { RotaryKnob, SmoothSlider, WaveformDisplay, EQSliderBank } from './components.js';
import { Visualizer } from './visualizer.js';

function ico(name: string, size = 18): string {
  const p: Record<string, string> = {
    play: '<polygon points="8,5 19,12 8,19" fill="currentColor"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
    prev: '<polygon points="17,18 9,12 17,6" fill="currentColor"/><rect x="5" y="6" width="2.5" height="12" fill="currentColor"/>',
    next: '<polygon points="7,6 15,12 7,18" fill="currentColor"/><rect x="16.5" y="6" width="2.5" height="12" fill="currentColor"/>',
    repeat: '<path d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    repeat1: '<path d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="16" text-anchor="middle" fill="currentColor" font-size="9" font-weight="700">1</text>',
    list: '<path d="M9 6h11M9 12h11M9 18h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4.5" cy="6" r="1.5" fill="currentColor"/><circle cx="4.5" cy="12" r="1.5" fill="currentColor"/><circle cx="4.5" cy="18" r="1.5" fill="currentColor"/>',
    shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    x: '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    mic: '<path d="M12 2a3 3 0 013 3v7a3 3 0 01-6 0V5a3 3 0 013-3z" fill="currentColor"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  };
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="pointer-events:none;flex-shrink:0">${p[name] ?? ''}</svg>`;
}

export class App {
  private engine: AudioEngine;
  private db: AudioDB;
  private plMgr: PlaylistManager;
  private viz: Visualizer;
  private waveform!: WaveformDisplay;
  private eqBank!: EQSliderBank;

  private state: AppState = { ...DEFAULT_STATE };
  private playing = false;
  private currentTrack: TrackMeta | null = null;
  private currentAudioData: ArrayBuffer | null = null;
  private trackMetas: TrackMeta[] = [];

  private pitchKnob!: RotaryKnob;
  private tempoKnob!: RotaryKnob;
  private volumeKnob!: RotaryKnob;
  private reverbSlider!: SmoothSlider;
  private bcBitsSlider!: SmoothSlider;
  private bcRedSlider!: SmoothSlider;
  private modRateKnob!: RotaryKnob;
  private modDepthKnob!: RotaryKnob;
  private modFbKnob!: RotaryKnob;
  private compThrSlider!: SmoothSlider;
  private compRatSlider!: SmoothSlider;
  private compAtkSlider!: SmoothSlider;
  private compRelSlider!: SmoothSlider;
  private compMkSlider!: SmoothSlider;
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private levelBars: HTMLElement[] = [];
  private levelRaf = 0;
  private isMobile = false;
  private mobileView: 'player' | 'playlist' | 'fx' = 'player';
  private $: Record<string, HTMLElement> = {};

  constructor(engine: AudioEngine, db: AudioDB) {
    this.engine = engine;
    this.db = db;
    this.plMgr = new PlaylistManager(db);
    this.viz = new Visualizer(document.getElementById('viz-container')!);
  }

  async init(): Promise<void> {
    const ids = [
      'btn-open', 'btn-play', 'btn-stop', 'btn-prev', 'btn-next',
      'btn-loop-mode', 'btn-play-mode', 'btn-ab-clear', 'btn-vocal',
      'btn-reverse', 'btn-bc-toggle', 'btn-export',
      'time-current', 'time-total', 'track-name',
      'param-area', 'eq-area', 'fx-area', 'waveform-area',
      'playlist-list', 'playlist-area', 'btn-add-playlist',
      'eq-preset-select',
      'btn-formant', 'btn-mod-toggle', 'btn-comp-toggle',
      'bpm-display', 'btn-settings', 'mod-area', 'comp-area', 'mod-mode-select',
      'level-meter', 'btn-add-playlist-desktop', 'btn-back-player', 'nav-player', 'nav-playlist', 'nav-fx',
      'pitch-display', 'btn-mic',
    ];
    for (const id of ids) {
      this.$[id] = document.getElementById(id) as HTMLElement;
    }

    await this.db.open();
    await this.plMgr.loadFromDB();
    await this.engine.init();
    this.viz.connect(this.engine.analyser, this.engine.audioContext);

    this.initLevelMeter();
    this.initMobileNav();
    this.createControls();
    this.engine.on((ev) => this.onEngineEvent(ev));

    if (await this.db.hasLegacyAudio()) {
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);background:#f06020;color:#fff;padding:10px 20px;border-radius:8px;font-size:.8rem;z-index:999;max-width:90vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      banner.textContent = '⚠️ 旧形式のトラックが見つかりました。再インポートで新しいOPFSストレージに移行できます。';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'margin-left:12px;background:transparent;border:none;color:#fff;font-size:1rem;cursor:pointer;';
      closeBtn.onclick = () => banner.remove();
      banner.appendChild(closeBtn);
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 8000);
    }

    this.engine.audioContext.addEventListener('statechange', () => {
      if (this.engine.audioContext.state === 'suspended' && this.playing) {
        this.playing = false;
        this.updatePlayButton();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.engine.audioContext.state === 'suspended' && this.playing) {
        this.engine.audioContext.resume();
      }
    });

    this.wireButtons();
    this.loadState();
    this.trackMetas = await this.db.getAllTrackMetas();

    if (this.state.currentPlaylistId) {
      this.plMgr.setCurrentPlaylist(this.state.currentPlaylistId);
    } else {
      const allPl = this.plMgr.getAll();
      if (allPl.length > 0) this.plMgr.setCurrentPlaylist(allPl[0].id);
    }

    this.renderPlaylist();

    if (this.state.currentTrackId) {
      await this.loadTrack(this.state.currentTrackId, false);
    }
  }

  private initLevelMeter(): void {
    const container = this.$['level-meter'];
    if (!container) return;
    const BAR_COUNT = 8;
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = document.createElement('div');
      bar.className = 'lm-bar';
      container.appendChild(bar);
      this.levelBars.push(bar);
    }
    const analyser = this.engine.analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (document.hidden) { this.levelRaf = 0; return; }
      analyser.getByteFrequencyData(buf);
      const step = Math.floor(buf.length / BAR_COUNT);
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += buf[i * step + j];
        const avg = sum / step / 255;
        const h = Math.max(2, avg * 28);
        this.levelBars[i].style.height = `${h}px`;
        this.levelBars[i].classList.toggle('clip', avg > 0.95);
      }
      this.levelRaf = requestAnimationFrame(tick);
    };
    const startMeter = () => { if (!this.levelRaf && !document.hidden) this.levelRaf = requestAnimationFrame(tick); };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (this.levelRaf) { cancelAnimationFrame(this.levelRaf); this.levelRaf = 0; } }
      else { startMeter(); }
    });
    startMeter();
  }

  private initMobileNav(): void {
    const mq = window.matchMedia('(max-width:900px)');
    this.isMobile = mq.matches;
    mq.addEventListener('change', (e) => {
      this.isMobile = e.matches;
      if (!this.isMobile) {
        document.querySelector('.left-panel')?.classList.remove('mobile-visible');
        document.querySelector('.right-panel')?.classList.remove('mobile-visible');
      }
      this.updateMobileView();
    });

    this.$['nav-player']?.addEventListener('click', () => { this.mobileView = 'player'; this.updateMobileView(); });
    this.$['nav-playlist']?.addEventListener('click', () => { this.mobileView = 'playlist'; this.updateMobileView(); });
    this.$['nav-fx']?.addEventListener('click', () => { this.mobileView = 'fx'; this.updateMobileView(); });
    this.$['btn-back-player']?.addEventListener('click', () => { this.mobileView = 'player'; this.updateMobileView(); });
    this.updateMobileView();
  }

  private updateMobileView(): void {
    const left = document.querySelector('.left-panel') as HTMLElement;
    const right = document.querySelector('.right-panel') as HTMLElement;
    const navPlayer = this.$['nav-player'];
    const navPlaylist = this.$['nav-playlist'];
    const navFx = this.$['nav-fx'];
    if (!this.isMobile) { left?.classList.remove('mobile-visible'); right?.classList.remove('mobile-visible'); return; }
    if (this.mobileView === 'player') {
      left?.classList.remove('mobile-visible'); right?.classList.remove('mobile-visible');
      navPlayer?.classList.add('active'); navPlaylist?.classList.remove('active'); navFx?.classList.remove('active');
    } else if (this.mobileView === 'playlist') {
      left?.classList.add('mobile-visible'); right?.classList.remove('mobile-visible');
      navPlayer?.classList.remove('active'); navPlaylist?.classList.add('active'); navFx?.classList.remove('active');
    } else {
      left?.classList.remove('mobile-visible'); right?.classList.add('mobile-visible');
      navPlayer?.classList.remove('active'); navPlaylist?.classList.remove('active'); navFx?.classList.add('active');
    }
  }

  private createControls(): void {
    const p = this.$['param-area'];
    this.pitchKnob = new RotaryKnob(p, 'ピッチ', -24, 24, this.state.pitch, 0.5, ' st');
    this.pitchKnob.onChange = (v) => { this.state.pitch = v; this.engine.setPitch(v); this.engine.setFormant(this.state.formant, v); this.saveState(); };
    this.tempoKnob = new RotaryKnob(p, 'テンポ', 25, 400, this.state.tempo * 100, 1, '%');
    this.tempoKnob.onChange = (v) => { this.state.tempo = v / 100; this.engine.setTempo(this.state.tempo); this.saveState(); };
    this.volumeKnob = new RotaryKnob(p, '音量', 0, 100, this.state.volume * 100, 1, '%');
    this.volumeKnob.onChange = (v) => { this.state.volume = v / 100; this.engine.setVolume(this.state.volume); this.saveState(); };

    this.waveform = new WaveformDisplay(this.$['waveform-area']);
    this.waveform.onClick = (t) => { if (this.engine.duration > 0) this.engine.seek(t * this.engine.duration); };
    this.waveform.onLoopSelect = (s, e) => {
      this.state.loopStart = s; this.state.loopEnd = e; this.state.loopMode = LoopMode.AB;
      this.engine.setLoop(s, e); this.updateLoopButton(); this.saveState();
    };

    this.eqBank = new EQSliderBank(this.$['eq-area'], DEFAULT_EQ_BANDS, this.state.eqGains);
    this.eqBank.onChange = (i, v) => { this.state.eqGains[i] = v; this.engine.setEQBand(i, v); this.saveState(); };

    const sel = this.$['eq-preset-select'] as HTMLSelectElement;
    if (sel) {
      EQ_PRESETS.forEach(pr => {
        const opt = document.createElement('option'); opt.value = pr.name; opt.textContent = pr.name; sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        const preset = EQ_PRESETS.find(pr => pr.name === sel.value);
        if (preset) { this.state.eqGains = [...preset.bands]; this.eqBank.setGains(this.state.eqGains); this.engine.setEQAll(this.state.eqGains); this.saveState(); }
      });
    }

    const fx = this.$['fx-area'];
    this.reverbSlider = new SmoothSlider(fx, 'リバーブ', 0, 100, this.state.reverb * 100, 1, '%');
    this.reverbSlider.onChange = (v) => { this.state.reverb = v / 100; this.engine.setReverb(this.state.reverb); this.saveState(); };
    this.bcBitsSlider = new SmoothSlider(fx, 'ビット深度', 1, 16, this.state.bitcrusherBits, 1, ' bit');
    this.bcBitsSlider.onChange = (v) => { this.state.bitcrusherBits = v; this.engine.setBitcrusher(v, this.state.bitcrusherReduction, this.state.bitcrusherEnabled); this.saveState(); };
    this.bcRedSlider = new SmoothSlider(fx, 'ダウンサンプル', 1, 32, this.state.bitcrusherReduction, 1, 'x');
    this.bcRedSlider.onChange = (v) => { this.state.bitcrusherReduction = v; this.engine.setBitcrusher(this.state.bitcrusherBits, v, this.state.bitcrusherEnabled); this.saveState(); };

    const ma = this.$['mod-area'];
    if (ma) {
      this.modRateKnob = new RotaryKnob(ma, 'レート', 0.01, 10, this.state.mod.rate, 0.01, 'Hz');
      this.modRateKnob.onChange = v => { this.state.mod.rate = v; this.engine.setModulation(this.state.mod); this.saveState(); };
      this.modDepthKnob = new RotaryKnob(ma, '深さ', 0, 1, this.state.mod.depth, 0.01);
      this.modDepthKnob.onChange = v => { this.state.mod.depth = v; this.engine.setModulation(this.state.mod); this.saveState(); };
      this.modFbKnob = new RotaryKnob(ma, 'FB', -0.95, 0.95, this.state.mod.fb, 0.01);
      this.modFbKnob.onChange = v => { this.state.mod.fb = v; this.engine.setModulation(this.state.mod); this.saveState(); };
    }
    const ca = this.$['comp-area'];
    if (ca) {
      this.compThrSlider = new SmoothSlider(ca, 'スレッショルド', -60, 0, this.state.comp.thr, 1, 'dB');
      this.compThrSlider.onChange = v => { this.state.comp.thr = v; this.engine.setCompressor(this.state.comp); this.saveState(); };
      this.compRatSlider = new SmoothSlider(ca, 'レシオ', 1, 20, this.state.comp.rat, 0.5, ':1');
      this.compRatSlider.onChange = v => { this.state.comp.rat = v; this.engine.setCompressor(this.state.comp); this.saveState(); };
      this.compAtkSlider = new SmoothSlider(ca, 'アタック', 0.1, 200, this.state.comp.atk, 0.1, 'ms');
      this.compAtkSlider.onChange = v => { this.state.comp.atk = v; this.engine.setCompressor(this.state.comp); this.saveState(); };
      this.compRelSlider = new SmoothSlider(ca, 'リリース', 10, 2000, this.state.comp.rel, 1, 'ms');
      this.compRelSlider.onChange = v => { this.state.comp.rel = v; this.engine.setCompressor(this.state.comp); this.saveState(); };
      this.compMkSlider = new SmoothSlider(ca, 'メイクアップ', 0, 40, this.state.comp.mkup, 0.5, 'dB');
      this.compMkSlider.onChange = v => { this.state.comp.mkup = v; this.engine.setCompressor(this.state.comp); this.saveState(); };
    }
  }

  private wireButtons(): void {
    this.$['btn-open']?.addEventListener('click', () => this.openFiles());
    this.$['btn-play']?.addEventListener('click', () => this.togglePlay());
    this.$['btn-stop']?.addEventListener('click', () => this.doStop());
    this.$['btn-prev']?.addEventListener('click', () => this.doPrev());
    this.$['btn-next']?.addEventListener('click', () => this.doNext());
    this.$['btn-loop-mode']?.addEventListener('click', () => this.cycleLoopMode());
    this.$['btn-ab-clear']?.addEventListener('click', () => {
      this.state.loopMode = LoopMode.None; this.state.loopStart = 0; this.state.loopEnd = 0;
      this.engine.clearLoop(); this.waveform.clearLoop(); this.updateLoopButton(); this.saveState();
    });
    this.$['btn-play-mode']?.addEventListener('click', () => this.cyclePlayMode());
    this.$['btn-vocal']?.addEventListener('click', () => {
      this.state.vocalCancel = !this.state.vocalCancel;
      this.engine.setVocalCancel(this.state.vocalCancel);
      this.$['btn-vocal'].classList.toggle('active', this.state.vocalCancel);
      this.saveState();
    });
    this.$['btn-reverse']?.addEventListener('click', () => {
      this.state.reverse = !this.state.reverse;
      this.engine.setReverse();
      this.$['btn-reverse'].classList.toggle('active', this.state.reverse);
      this.saveState();
    });
    this.$['btn-bc-toggle']?.addEventListener('click', () => {
      this.state.bitcrusherEnabled = !this.state.bitcrusherEnabled;
      this.engine.setBitcrusher(this.state.bitcrusherBits, this.state.bitcrusherReduction, this.state.bitcrusherEnabled);
      this.$['btn-bc-toggle'].classList.toggle('active', this.state.bitcrusherEnabled);
      this.saveState();
    });
    this.$['btn-export']?.addEventListener('click', () => this.exportWAV());
    this.$['btn-formant']?.addEventListener('click', () => {
      this.state.formant = !this.state.formant;
      this.engine.setFormant(this.state.formant, this.state.pitch);
      this.$['btn-formant']?.classList.toggle('active', this.state.formant);
      this.saveState();
    });
    this.$['btn-mod-toggle']?.addEventListener('click', () => {
      this.state.mod.en = !this.state.mod.en;
      this.engine.setModulation(this.state.mod);
      this.$['btn-mod-toggle']?.classList.toggle('active', this.state.mod.en);
      this.saveState();
    });
    const modSel = this.$['mod-mode-select'] as HTMLSelectElement;
    modSel?.addEventListener('change', () => {
      const map: Record<string, ModMode> = { fl: ModMode.Fl, ch: ModMode.Ch, ph: ModMode.Ph };
      this.state.mod.mode = map[modSel.value] ?? ModMode.Fl;
      this.engine.setModulation(this.state.mod); this.saveState();
    });
    this.$['btn-comp-toggle']?.addEventListener('click', () => {
      this.state.comp.en = !this.state.comp.en;
      this.engine.setCompressor(this.state.comp);
      this.$['btn-comp-toggle']?.classList.toggle('active', this.state.comp.en);
      this.saveState();
    });
    this.$['btn-settings']?.addEventListener('click', () => this.openSettings());

    const addPl = async () => {
      const defaultName = `プレイリスト ${this.plMgr.getAll().length + 1}`;
      await this.plMgr.createPlaylist(defaultName);
      this.renderPlaylist();
    };
    this.$['btn-add-playlist']?.addEventListener('click', addPl);
    this.$['btn-add-playlist-desktop']?.addEventListener('click', addPl);

    this.$['btn-mic']?.addEventListener('click', async () => {
      if (this.engine.micActive) {
        this.engine.stopMic();
        this.$['btn-mic']?.classList.remove('active');
        this.$['btn-mic']?.setAttribute('title', 'マイク入力OFF');
      } else {
        try {
          await this.engine.startMic();
          this.$['btn-mic']?.classList.add('active');
          this.$['btn-mic']?.setAttribute('title', 'マイク入力ON ●REC');
        } catch {
          this.showToast('マイクへのアクセスを許可してください', true);
        }
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); this.togglePlay(); break;
        case 'ArrowLeft': this.engine.seek(Math.max(0, this.currentTime() - 5)); break;
        case 'ArrowRight': this.engine.seek(this.currentTime() + 5); break;
        case 'ArrowUp': e.preventDefault(); this.adjustTempo(5); break;
        case 'ArrowDown': e.preventDefault(); this.adjustTempo(-5); break;
      }
    });
  }

  private openFiles(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = [
      'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac',
      'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/x-m4a',
      '.mp3', '.mp4', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.wav', '.webm', '.opus',
    ].join(',');
    input.addEventListener('change', async () => {
      const files = input.files;
      if (!files) return;
      for (const file of files) await this.importFile(file);
      this.trackMetas = await this.db.getAllTrackMetas();
      this.renderPlaylist();
      if (!this.currentTrack && this.trackMetas.length > 0) {
        await this.loadTrack(this.trackMetas[this.trackMetas.length - 1].id, true);
      }
    });
    input.click();
  }

  private showToast(msg: string, isError = false): void {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);background:${isError ? 'var(--danger)' : 'var(--accent)'};color:#fff;padding:10px 22px;border-radius:20px;font-size:.85rem;font-weight:600;z-index:9999;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;white-space:nowrap;`;
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 3000);
  }

  private async importFile(file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    const tempCtx = new AudioContext();
    try {
      const decoded = await tempCtx.decodeAudioData(buf.slice(0));
      const meta = await this.db.addTrack(file, buf, { duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels });
      const pl = this.plMgr.getCurrent();
      if (pl) await this.plMgr.addTrack(pl.id, meta.id);
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        this.showToast('ストレージ容量が不足しています。不要なトラックを削除してください。', true);
      } else {
        this.showToast(`「${file.name}」は対応していないファイル形式です`, true);
      }
    } finally {
      await tempCtx.close();
    }
  }

  private _loadingId: string | null = null;

  private async loadTrack(id: string, autoPlay: boolean): Promise<void> {
    this._loadingId = id;
    this.$['track-name'].textContent = '⏳ 読み込み中...';
    this.$['btn-play']?.setAttribute('disabled', '');
    try {
      const meta = await this.db.getTrackMeta(id);
      const audioData = await this.db.getAudioData(id);
      if (!meta || !audioData || this._loadingId !== id) return;
      this.currentTrack = meta; this.currentAudioData = audioData;
      this.state.currentTrackId = id; this.plMgr.setCurrentTrack(id);
      const decoded = await this.engine.audioContext.decodeAudioData(audioData.slice(0));
      if (this._loadingId !== id) return;
      await this.engine.loadBuffer(decoded);
      if (this._loadingId !== id) return;
      this.engine.setPitch(this.state.pitch);
      this.engine.setTempo(this.state.tempo);
      this.engine.setVolume(this.state.volume);
      this.engine.setEQAll(this.state.eqGains);
      this.engine.setReverb(this.state.reverb);
      this.engine.setBitcrusher(this.state.bitcrusherBits, this.state.bitcrusherReduction, this.state.bitcrusherEnabled);
      this.engine.setVocalCancel(this.state.vocalCancel);
      this.engine.setFormant(this.state.formant, this.state.pitch);
      this.engine.setModulation(this.state.mod);
      this.engine.setCompressor(this.state.comp);
      this.$['track-name'].textContent = meta.name;
      this.$['time-total'].textContent = formatTime(meta.duration);
      this.highlightCurrentTrack();
      this.saveState();
      if (autoPlay) { this.playing = true; this.updatePlayButton(); this.engine.play(); this.viz.setPlaying(true); }

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: meta.name, artist: 'WaveForge' });
        navigator.mediaSession.setActionHandler('play', () => { this.engine.play(); this.playing = true; this.updatePlayButton(); this.viz.setPlaying(true); });
        navigator.mediaSession.setActionHandler('pause', () => { this.engine.pause(); this.playing = false; this.updatePlayButton(); this.viz.setPlaying(false); });
        navigator.mediaSession.setActionHandler('previoustrack', () => this.doPrev());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.doNext());
      }

      if (this.state.loopMode === LoopMode.AB && this.state.loopStart > 0) {
        this.engine.setLoop(this.state.loopStart, this.state.loopEnd);
        this.waveform.setLoop(this.state.loopStart, this.state.loopEnd);
      } else if (this.state.loopMode === LoopMode.Single) {
        this.engine.setLoop(0, meta.duration);
      }
      this.waveform.setAudioBuffer(decoded);
      if (this.settings.bpmAuto && this.currentAudioData) this.engine.detectBPM(this.currentAudioData.slice(0));
    } catch (err) {
      console.error('loadTrack failed:', err);
      this.$['track-name'].textContent = '⚠️ 読み込み失敗';
    } finally {
      if (this._loadingId === id) this._loadingId = null;
      this.$['btn-play']?.removeAttribute('disabled');
    }
  }

  private togglePlay(): void {
    if (this.playing) { this.engine.pause(); this.playing = false; this.viz.setPlaying(false); }
    else { this.engine.play(); this.playing = true; this.viz.setPlaying(true); }
    this.updatePlayButton();
  }

  private doStop(): void {
    this.engine.stop(); this.playing = false; this.viz.setPlaying(false);
    this.updatePlayButton(); this.$['time-current'].textContent = '0:00.0'; this.waveform.setPosition(0);
  }

  private async doNext(): Promise<void> { const id = this.plMgr.getNextTrackId(); if (id) await this.loadTrack(id, true); }
  private async doPrev(): Promise<void> { const id = this.plMgr.getPrevTrackId(); if (id) await this.loadTrack(id, true); }

  private _lastPos = 0;
  private currentTime(): number { return this._lastPos; }

  private _posRafPending = false;
  private _lastPosCurrent = 0;
  private _lastPosTotal = 0;
  private _pitchTickCount = 0;

  private onEngineEvent(ev: EngineEvent): void {
    switch (ev.type) {
      case 'position': {
        this._lastPosCurrent = ev.current; this._lastPosTotal = ev.total;
        if (!this._posRafPending) {
          this._posRafPending = true;
          requestAnimationFrame(() => {
            this._posRafPending = false;
            if (document.hidden) return;
            this.$['time-current'].textContent = formatTime(this._lastPosCurrent);
            if (this._lastPosTotal > 0) this.waveform.setPosition(this._lastPosCurrent / this._lastPosTotal);
            this._pitchTickCount = (this._pitchTickCount + 1) % 12;
            if (this._pitchTickCount === 0) {
              const pd = this.$['pitch-display'];
              if (pd) { const p = this.engine.detectPitch(); pd.textContent = p ? `${p.note} ${p.hz}Hz` : ''; }
            }
          });
        }
        this._lastPos = ev.current;
        break;
      }
      case 'ended': this.handleTrackEnd(); break;
      case 'loaded': this.$['time-total'].textContent = formatTime(ev.duration); break;
      case 'bpm': {
        this.state.bpm = ev.value;
        const bE = this.$['bpm-display'];
        if (bE) bE.textContent = ev.value > 0 ? `${ev.value} BPM` : '-- BPM';
        this.saveState();
        break;
      }
    }
  }

  private async handleTrackEnd(): Promise<void> {
    switch (this.state.loopMode) {
      case LoopMode.Single: this.engine.seek(0); this.engine.play(); return;
      case LoopMode.AB: this.engine.seek(this.state.loopStart); this.engine.play(); return;
    }
    const nextId = this.plMgr.getNextTrackId();
    if (nextId) { await this.loadTrack(nextId, true); }
    else if (this.state.playMode === PlayMode.RepeatAll) {
      const pl = this.plMgr.getCurrent();
      if (pl && pl.trackIds.length > 0) { this.plMgr.setCurrentIndex(0); await this.loadTrack(pl.trackIds[0], true); }
    } else { this.playing = false; this.updatePlayButton(); }
  }

  private cycleLoopMode(): void {
    const modes = [LoopMode.None, LoopMode.Single, LoopMode.AB, LoopMode.All];
    this.state.loopMode = modes[(modes.indexOf(this.state.loopMode) + 1) % modes.length];
    if (this.state.loopMode === LoopMode.Single && this.currentTrack) this.engine.setLoop(0, this.currentTrack.duration);
    else if (this.state.loopMode === LoopMode.AB && this.state.loopStart > 0) {
      this.engine.setLoop(this.state.loopStart, this.state.loopEnd);
      this.waveform.setLoop(this.state.loopStart, this.state.loopEnd);
    } else if (this.state.loopMode === LoopMode.None) { this.engine.clearLoop(); this.waveform.clearLoop(); }
    this.updateLoopButton(); this.saveState();
  }

  private cyclePlayMode(): void {
    const modes = [PlayMode.Sequential, PlayMode.Shuffle, PlayMode.RepeatOne, PlayMode.RepeatAll];
    this.state.playMode = modes[(modes.indexOf(this.state.playMode) + 1) % modes.length];
    this.plMgr.playMode = this.state.playMode; this.updatePlayModeButton(); this.saveState();
  }

  private adjustTempo(delta: number): void {
    const newVal = clamp((this.state.tempo * 100) + delta, 25, 400);
    this.state.tempo = newVal / 100; this.engine.setTempo(this.state.tempo); this.tempoKnob.value = newVal; this.saveState();
  }

  private updatePlayButton(): void {
    const btn = this.$['btn-play'];
    if (btn) { btn.innerHTML = ico(this.playing ? 'pause' : 'play'); btn.classList.toggle('active', this.playing); }
  }

  private updateLoopButton(): void {
    const btn = this.$['btn-loop-mode'];
    if (!btn) return;
    const icons: Record<string, string> = {
      [LoopMode.None]: ico('repeat', 16), [LoopMode.Single]: ico('repeat1', 16),
      [LoopMode.AB]: 'A-B', [LoopMode.All]: ico('repeat', 16) + '<span style="font-size:.6rem">ALL</span>',
    };
    btn.innerHTML = icons[this.state.loopMode] ?? ico('repeat', 16);
    btn.classList.toggle('active', this.state.loopMode !== LoopMode.None);
  }

  private updatePlayModeButton(): void {
    const btn = this.$['btn-play-mode'];
    if (!btn) return;
    const icons: Record<string, string> = {
      [PlayMode.Sequential]: ico('list', 16), [PlayMode.Shuffle]: ico('shuffle', 16),
      [PlayMode.RepeatOne]: ico('repeat1', 16), [PlayMode.RepeatAll]: ico('repeat', 16),
    };
    btn.innerHTML = icons[this.state.playMode] ?? ico('list', 16);
  }

  private _pitchTickCountRender = 0;

  private renderPlaylist(): void {
    const container = this.$['playlist-list'];
    if (!container) return;
    container.innerHTML = '';
    const pl = this.plMgr.getCurrent();
    if (!pl) return;

    const tabWrap = document.createElement('div');
    tabWrap.className = 'pl-tabs';
    for (const p of this.plMgr.getAll()) {
      const tab = document.createElement('button');
      tab.className = 'pl-tab' + (p.id === pl.id ? ' active' : '');
      tab.textContent = p.name;
      tab.addEventListener('click', () => {
        this.plMgr.setCurrentPlaylist(p.id);
        this.state.currentPlaylistId = p.id;
        this.saveState();
        this.renderPlaylist();
      });
      tabWrap.appendChild(tab);
    }
    container.appendChild(tabWrap);

    const ITEM_H = 48;
    const allIds = pl.trackIds.filter(tid => this.trackMetas.find(m => m.id === tid));
    const totalH = Math.max(allIds.length * ITEM_H, 1);

    const scroll = document.createElement('div');
    scroll.style.cssText = 'height:calc(100% - 40px);overflow-y:auto;position:relative;';
    const scroller = document.createElement('ul');
    scroller.className = 'track-list';
    scroller.style.cssText = `position:relative;height:${totalH}px;`;
    scroll.appendChild(scroller);
    container.appendChild(scroll);

    const VISIBLE_BUFFER = 5;
    const renderRange = () => {
      const top = scroll.scrollTop;
      const clientH = scroll.clientHeight || 400;
      const startIdx = Math.max(0, Math.floor(top / ITEM_H) - VISIBLE_BUFFER);
      const endIdx = Math.min(allIds.length, Math.ceil((top + clientH) / ITEM_H) + VISIBLE_BUFFER);
      const rendered = new Set<string>();
      for (let idx = startIdx; idx < endIdx; idx++) {
        const tid = allIds[idx];
        rendered.add(tid);
        const meta = this.trackMetas.find(m => m.id === tid)!;
        const isPlaying = this.currentTrack?.id === tid;
        let li = scroller.querySelector(`[data-tid="${tid}"]`) as HTMLElement | null;
        if (!li) {
          li = document.createElement('li');
          li.className = 'track-item';
          li.dataset.tid = tid;
          li.style.cssText = `position:absolute;left:0;right:0;height:${ITEM_H}px;display:flex;align-items:center;`;

          const eqEl = document.createElement('span');
          eqEl.className = 'track-item-eq';
          eqEl.innerHTML = '<span></span><span></span><span></span>';
          li.appendChild(eqEl);

          const idxSpan = document.createElement('span');
          idxSpan.className = 'track-item-idx';
          li.appendChild(idxSpan);

          const nameSpan = document.createElement('span');
          nameSpan.className = 'track-item-name';
          nameSpan.textContent = meta.name;
          nameSpan.addEventListener('click', () => {
            this.loadTrack(tid, true);
            if (this.isMobile) { this.mobileView = 'player'; this.updateMobileView(); }
          });
          li.appendChild(nameSpan);

          const durSpan = document.createElement('span');
          durSpan.className = 'track-item-dur';
          durSpan.textContent = formatTime(meta.duration);
          li.appendChild(durSpan);

          const delBtn = document.createElement('button');
          delBtn.className = 'track-item-del';
          delBtn.title = '削除';
          delBtn.innerHTML = ico('x', 14);
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`「${meta.name}」をライブラリから完全に削除しますか？\n（すべてのプレイリストから削除されます）`)) return;
            await this.db.deleteTrackCascade(tid);
            this.trackMetas = this.trackMetas.filter(m => m.id !== tid);
            if (this.currentTrack?.id === tid) { this.currentTrack = null; this.engine.stop(); this.playing = false; this.updatePlayButton(); }
            this.renderPlaylist();
          });
          li.appendChild(delBtn);
          scroller.appendChild(li);
        }
        li.style.top = `${idx * ITEM_H}px`;
        li.classList.toggle('playing', isPlaying);
        const eqEl = li.querySelector('.track-item-eq') as HTMLElement;
        if (eqEl) eqEl.style.display = isPlaying ? '' : 'none';
        (li.querySelector('.track-item-idx') as HTMLElement).textContent = String(idx + 1);
      }
      Array.from(scroller.querySelectorAll<HTMLElement>('.track-item')).forEach(el => {
        if (!rendered.has(el.dataset.tid!)) el.remove();
      });
    };
    renderRange();
    scroll.addEventListener('scroll', renderRange, { passive: true });
  }

  private _eqIcon: HTMLElement | null = null;

  private highlightCurrentTrack(): void {
    const prevPlaying = document.querySelector('.track-item.playing');
    if (prevPlaying) {
      prevPlaying.classList.remove('playing');
      const icon = prevPlaying.querySelector('.track-item-eq');
      if (icon) (icon as HTMLElement).style.display = 'none';
    }
    if (!this.currentTrack) return;
    const items = document.querySelectorAll<HTMLElement>('.track-item');
    const pl = this.plMgr.getCurrent();
    if (!pl) return;
    for (const li of items) {
      if (li.dataset.tid === this.currentTrack.id) {
        li.classList.add('playing');
        const eq = li.querySelector('.track-item-eq') as HTMLElement;
        if (eq) eq.style.display = '';
        break;
      }
    }
  }

  private async exportWAV(): Promise<void> {
    if (!this.currentAudioData || !this.currentTrack) { alert('エクスポートする曲がありません'); return; }
    const MAX_SAFE_EXPORT_SEC = 900;
    const exportedDuration = this.currentTrack.duration / this.state.tempo;
    if (exportedDuration > MAX_SAFE_EXPORT_SEC) {
      if (!confirm(`この曲は約 ${Math.floor(exportedDuration / 60)} 分あります。\n長時間ファイルのエクスポートはブラウザのメモリ上限に達してクラッシュする可能性があります。\n続行しますか？`)) return;
    }
    const btn = this.$['btn-export'];
    const orig = btn.innerHTML;
    btn.textContent = 'レンダリング中…'; btn.classList.add('disabled');
    try {
      const rendered = await this.engine.renderOffline(
        this.currentAudioData, this.state.pitch, this.state.tempo, this.state.eqGains,
        this.state.vocalCancel, { bits: this.state.bitcrusherBits, reduction: this.state.bitcrusherReduction, enabled: this.state.bitcrusherEnabled }, this.state.reverb,
      );
      downloadWAV(rendered, this.currentTrack.name);
    } catch (err) {
      console.error('Export failed:', err); alert('エクスポートに失敗しました');
    } finally { btn.innerHTML = orig; btn.classList.remove('disabled'); }
  }

  private saveState(): void {
    try { localStorage.setItem('wf-state', JSON.stringify(this.state)); } catch { }
  }

  private loadState(): void {
    try {
      const raw = localStorage.getItem('wf-state');
      if (raw) {
        const s = JSON.parse(raw) as Partial<AppState>;
        Object.assign(this.state, s);
        this.pitchKnob.value = this.state.pitch;
        this.tempoKnob.value = this.state.tempo * 100;
        this.volumeKnob.value = this.state.volume * 100;
        this.reverbSlider.value = this.state.reverb * 100;
        this.bcBitsSlider.value = this.state.bitcrusherBits;
        this.bcRedSlider.value = this.state.bitcrusherReduction;
        this.eqBank.setGains(this.state.eqGains);
        this.plMgr.playMode = this.state.playMode;
        this.updateLoopButton(); this.updatePlayModeButton();
        this.$['btn-vocal']?.classList.toggle('active', this.state.vocalCancel);
        this.$['btn-reverse']?.classList.toggle('active', this.state.reverse);
        this.$['btn-bc-toggle']?.classList.toggle('active', this.state.bitcrusherEnabled);
        this.$['btn-formant']?.classList.toggle('active', this.state.formant);
        this.$['btn-mod-toggle']?.classList.toggle('active', this.state.mod?.en);
        this.$['btn-comp-toggle']?.classList.toggle('active', this.state.comp?.en);
        if (this.state.bpm > 0) { const bE = this.$['bpm-display']; if (bE) bE.textContent = `${this.state.bpm} BPM`; }
      }
    } catch { }
    try { const raw = localStorage.getItem('wf-settings'); if (raw) Object.assign(this.settings, JSON.parse(raw)); } catch { }
  }

  private saveSettings(): void {
    try { localStorage.setItem('wf-settings', JSON.stringify(this.settings)); } catch { }
  }

  private openSettings(): void {
    let m = document.getElementById('settings-overlay');
    if (m) { m.remove(); return; }
    m = document.createElement('div'); m.id = 'settings-overlay';
    m.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)';
    const p = document.createElement('div');
    p.style.cssText = 'background:#fff;border:1px solid rgba(0,0,0,.09);border-radius:14px;padding:24px;min-width:320px;max-width:90vw;color:#1a1a1a;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.12)';
    p.innerHTML = `
      <h3 style="margin:0 0 16px;font-size:1.05rem;color:#f06020;font-weight:700">設定</h3>
      <label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-size:.85rem;cursor:pointer;min-height:44px">
        <input type="checkbox" id="set-formant" ${this.settings.formantDef ? 'checked' : ''} style="accent-color:#f06020;width:18px;height:18px"> フォルマント補正デフォルトON
      </label>
      <label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-size:.85rem;cursor:pointer;min-height:44px">
        <input type="checkbox" id="set-bpm-auto" ${this.settings.bpmAuto ? 'checked' : ''} style="accent-color:#f06020;width:18px;height:18px"> BPM自動検出
      </label>
      <div style="margin:12px 0;font-size:.85rem;display:flex;align-items:center;gap:8px;min-height:44px"><span>ビジュアライザ:</span>
        <select id="set-viz" style="background:#f5f5f7;border:1px solid rgba(0,0,0,.09);color:#1a1a1a;border-radius:8px;padding:6px 10px;font-size:.82rem;min-height:36px">
          <option value="bars" ${this.settings.vizMode === 'bars' ? 'selected' : ''}>バー</option>
          <option value="circ" ${this.settings.vizMode === 'circ' ? 'selected' : ''}>サークル</option>
          <option value="cmb" ${this.settings.vizMode === 'cmb' ? 'selected' : ''}>コンバインド</option>
        </select>
      </div>
      <div style="margin:12px 0;font-size:.85rem">
        <span>テーマ色相: <span id="hue-val">${this.settings.themeHue}</span></span>
        <input type="range" id="set-hue" min="0" max="360" value="${this.settings.themeHue}" style="width:100%;accent-color:#f06020;margin-top:6px;height:32px">
      </div>
      <div style="margin:12px 0;font-size:.85rem">
        <span style="font-weight:600">ストレージ使用量</span>
        <div style="margin-top:6px;background:#e8e8e8;border-radius:4px;height:10px;overflow:hidden">
          <div id="storage-bar" style="height:100%;background:#f06020;width:0%;transition:width .3s"></div>
        </div>
        <div id="storage-label" style="margin-top:4px;color:#666;font-size:.78rem">計算中...</div>
      </div>
      <button id="set-close" style="margin-top:16px;width:100%;padding:10px;background:#f06020;border:none;color:#fff;border-radius:8px;font-size:.85rem;cursor:pointer;font-weight:600;min-height:44px">閉じる</button>`;
    m.appendChild(p); document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m!.remove(); });
    p.querySelector('#set-close')!.addEventListener('click', () => m!.remove());
    p.querySelector('#set-formant')!.addEventListener('change', (e) => { this.settings.formantDef = (e.target as HTMLInputElement).checked; this.saveSettings(); });
    p.querySelector('#set-bpm-auto')!.addEventListener('change', (e) => { this.settings.bpmAuto = (e.target as HTMLInputElement).checked; this.saveSettings(); });
    p.querySelector('#set-viz')!.addEventListener('change', (e) => { this.settings.vizMode = (e.target as HTMLSelectElement).value as VizMode; this.saveSettings(); });
    p.querySelector('#set-hue')!.addEventListener('input', (e) => {
      const v = parseInt((e.target as HTMLInputElement).value);
      this.settings.themeHue = v;
      (p.querySelector('#hue-val') as HTMLElement).textContent = String(v);
      document.documentElement.style.setProperty('--accent', `hsl(${v},100%,50%)`);
      this.saveSettings();
    });
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then(({ usage = 0, quota = 1 }) => {
        const pct = Math.min(100, (usage / quota) * 100);
        const usedMB = (usage / 1024 / 1024).toFixed(1);
        const totalMB = (quota / 1024 / 1024).toFixed(0);
        const bar = p.querySelector('#storage-bar') as HTMLElement | null;
        const lbl = p.querySelector('#storage-label') as HTMLElement | null;
        if (bar) { bar.style.width = `${pct}%`; bar.style.background = pct > 80 ? '#e53935' : '#f06020'; }
        if (lbl) lbl.textContent = `${usedMB} MB 使用中 / 約 ${totalMB} MB (${pct.toFixed(1)}%)`;
      });
    } else {
      const lbl = p.querySelector('#storage-label') as HTMLElement | null;
      if (lbl) lbl.textContent = 'このブラウザは非対応です';
    }
  }
}
