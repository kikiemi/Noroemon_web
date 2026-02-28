import { DEFAULT_EQ_BANDS, EngineEvent, EngineEventHandler, clamp, ModState, CompState } from '../types.js';
import { PHASE_VOCODER_CODE, BITCRUSHER_CODE, VOCAL_CANCEL_CODE, FORMANT_CODE, MODULATION_CODE, COMPRESSOR_CODE } from './worklet-code.js';
import { BPM_WORKER_CODE } from './bpm-worker-code.js';

export class AudioEngine {
  private ctx!: AudioContext;
  private pvNode!: AudioWorkletNode;
  private fmNode!: AudioWorkletNode;
  private fmBypass!: GainNode;
  private fmEnabled = false;
  private vcNode!: AudioWorkletNode;
  private bcNode!: AudioWorkletNode;
  private mdNode!: AudioWorkletNode;
  private cpNode!: AudioWorkletNode;
  private eqNodes: BiquadFilterNode[] = [];
  private convolver!: ConvolverNode;
  private reverbWet!: GainNode;
  private reverbDry!: GainNode;
  private reverbMix!: GainNode;
  private masterGain!: GainNode;
  analyser!: AnalyserNode;
  private bpmWorker: Worker | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private _silentAudio: HTMLAudioElement | null = null;
  private listeners: EngineEventHandler[] = [];
  private _ready = false;
  private _duration = 0;
  private _sampleRate = 44100;
  private _bpmJobId = 0;

  get ready(): boolean { return this._ready; }
  get duration(): number { return this._duration; }
  get sampleRate(): number { return this._sampleRate; }
  get audioContext(): AudioContext { return this.ctx; }
  get micActive(): boolean { return this.micSource !== null; }

  async init(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: 44100 });

    await Promise.all([
      this.registerWorklet(PHASE_VOCODER_CODE),
      this.registerWorklet(FORMANT_CODE),
      this.registerWorklet(BITCRUSHER_CODE),
      this.registerWorklet(VOCAL_CANCEL_CODE),
      this.registerWorklet(MODULATION_CODE),
      this.registerWorklet(COMPRESSOR_CODE),
    ]);

    const wOpt = (n: number, o: number): AudioWorkletNodeOptions => ({ numberOfInputs: n, numberOfOutputs: o, outputChannelCount: [2] });
    this.pvNode = new AudioWorkletNode(this.ctx, 'phase-vocoder-processor', wOpt(0, 1));
    this.fmNode = new AudioWorkletNode(this.ctx, 'formant-processor', wOpt(1, 1));
    this.vcNode = new AudioWorkletNode(this.ctx, 'vocal-cancel-processor', wOpt(1, 1));
    this.mdNode = new AudioWorkletNode(this.ctx, 'mod-processor', wOpt(1, 1));
    this.bcNode = new AudioWorkletNode(this.ctx, 'bitcrusher-processor', wOpt(1, 1));
    this.cpNode = new AudioWorkletNode(this.ctx, 'comp-processor', wOpt(1, 1));

    this.eqNodes = DEFAULT_EQ_BANDS.map((freq, i) => {
      const f = this.ctx.createBiquadFilter();
      if (i === 0) { f.type = 'lowshelf'; }
      else if (i === DEFAULT_EQ_BANDS.length - 1) { f.type = 'highshelf'; }
      else { f.type = 'peaking'; f.Q.value = 1.4; }
      f.frequency.value = freq;
      f.gain.value = 0;
      return f;
    });

    this.convolver = this.ctx.createConvolver();
    this.convolver.buffer = this.createReverbIR(2.5, 3);
    this.reverbWet = this.ctx.createGain();
    this.reverbWet.gain.value = 0;
    this.reverbDry = this.ctx.createGain();
    this.reverbDry.gain.value = 1;
    this.reverbMix = this.ctx.createGain();
    this.reverbMix.gain.value = 1;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.fmBypass = this.ctx.createGain();
    this.fmBypass.gain.value = 1;

    // Default chain: pvNode -> fmBypass -> vcNode (formant bypassed)
    let node: AudioNode = this.pvNode;
    node.connect(this.fmBypass); node = this.fmBypass;
    node.connect(this.vcNode); node = this.vcNode;
    for (const eq of this.eqNodes) { node.connect(eq); node = eq; }
    node.connect(this.mdNode); node = this.mdNode;
    node.connect(this.bcNode); node = this.bcNode;
    node.connect(this.cpNode); node = this.cpNode;
    node.connect(this.reverbDry);
    node.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbDry.connect(this.reverbMix);
    this.reverbWet.connect(this.reverbMix);

    this.reverbMix.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // iOS background audio keepalive:
    // A looping silent <audio> element forces iOS to maintain the Audio
    // Session so the AudioContext continues when the screen is locked.
    const sil = document.createElement('audio');
    // 1-frame silent MP3 as data URI
    sil.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV';
    sil.loop = true;
    sil.volume = 0.001;
    sil.setAttribute('playsinline', '');
    sil.setAttribute('webkit-playsinline', '');
    document.body.appendChild(sil);
    this._silentAudio = sil;

    this.pvNode.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'position') {
        this.emit({ type: 'position', current: d.position, total: d.total });
      } else if (d.type === 'ended') {
        this.emit({ type: 'ended' });
      } else if (d.type === 'loaded') {
        this._duration = d.duration;
        this.emit({ type: 'loaded', duration: d.duration });
      }
    };

    this._ready = true;
  }

  private async registerWorklet(code: string): Promise<void> {
    // iOS Safari sometimes rejects Blob URLs for AudioWorklet.
    // Try Blob URL first, fall back to data: URL.
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    const tryUrl = async (url: string): Promise<boolean> => {
      try { await this.ctx.audioWorklet.addModule(url); return true; } catch { return false; }
    };
    const blobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    const ok = await tryUrl(blobUrl);
    URL.revokeObjectURL(blobUrl);
    if (!ok) {
      const b64 = btoa(unescape(encodeURIComponent(code)));
      await this.ctx.audioWorklet.addModule(`data:application/javascript;base64,${b64}`);
    }
  }

  async loadBuffer(audioBuffer: AudioBuffer): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this._sampleRate = audioBuffer.sampleRate;
    this._duration = audioBuffer.duration;
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      channels.push(audioBuffer.getChannelData(ch).slice());
    }
    this.pvNode.port.postMessage(
      { type: 'loadBuffer', channels, sampleRate: audioBuffer.sampleRate },
      channels.map(c => c.buffer),
    );
  }

  play(): void {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.pvNode.port.postMessage({ type: 'play' });
    // Start silent audio to keep iOS Audio Session alive in background
    this._silentAudio?.play().catch(() => {});
  }
  pause(): void { this.pvNode.port.postMessage({ type: 'pause' }); }
  stop(): void { this.pvNode.port.postMessage({ type: 'stop' }); }
  seek(seconds: number): void { this.pvNode.port.postMessage({ type: 'seek', position: seconds * this._sampleRate }); }
  setPitch(semitones: number): void { this.pvNode.port.postMessage({ type: 'setPitch', semitones: clamp(semitones, -24, 24) }); }
  setTempo(factor: number): void { this.pvNode.port.postMessage({ type: 'setTempo', tempo: clamp(factor, 0.25, 4) }); }
  setVolume(v: number): void { this.masterGain.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.02); }
  setLoop(startSec: number, endSec: number): void { this.pvNode.port.postMessage({ type: 'setLoop', start: startSec, end: endSec }); }
  clearLoop(): void { this.pvNode.port.postMessage({ type: 'clearLoop' }); }

  setEQBand(index: number, gainDb: number): void {
    if (this.eqNodes[index]) {
      this.eqNodes[index].gain.setTargetAtTime(clamp(gainDb, -12, 12), this.ctx.currentTime, 0.02);
    }
  }
  setEQAll(gains: number[]): void { gains.forEach((g, i) => this.setEQBand(i, g)); }

  setReverb(wet: number): void {
    const w = clamp(wet, 0, 1);
    this.reverbWet.gain.setTargetAtTime(w, this.ctx.currentTime, 0.03);
    this.reverbDry.gain.setTargetAtTime(1 - w * 0.5, this.ctx.currentTime, 0.03);
  }

  setBitcrusher(bits: number, reduction: number, enabled: boolean): void {
    const p = this.bcNode.parameters as Map<string, AudioParam>;
    const t = this.ctx.currentTime;
    (p.get('bits') as AudioParam).setValueAtTime(clamp(bits, 1, 16), t);
    (p.get('reduction') as AudioParam).setValueAtTime(clamp(reduction, 1, 64), t);
    (p.get('enabled') as AudioParam).setValueAtTime(enabled ? 1 : 0, t);
  }

  setVocalCancel(enabled: boolean): void {
    const p = this.vcNode.parameters as Map<string, AudioParam>;
    (p.get('enabled') as AudioParam).setValueAtTime(enabled ? 1 : 0, this.ctx.currentTime);
  }

  setReverse(): void { this.pvNode.port.postMessage({ type: 'reverse' }); }

  setFormant(enabled: boolean, pitchSemitones: number): void {
    if (enabled !== this.fmEnabled) {
      this.fmEnabled = enabled;
      if (enabled) {
        // pvNode -> fmNode -> fmBypass(passthru) -> vcNode
        try { this.pvNode.disconnect(this.fmBypass); } catch { /* already disconnected */ }
        this.pvNode.connect(this.fmNode);
        this.fmNode.connect(this.fmBypass);
      } else {
        // pvNode -> fmBypass -> vcNode  (fmNode out of chain)
        try { this.pvNode.disconnect(this.fmNode); } catch { /* already disconnected */ }
        try { this.fmNode.disconnect(this.fmBypass); } catch { /* already disconnected */ }
        this.pvNode.connect(this.fmBypass);
      }
    }
    const p = this.fmNode.parameters as Map<string, AudioParam>;
    const t = this.ctx.currentTime;
    (p.get('enabled') as AudioParam).setValueAtTime(enabled ? 1 : 0, t);
    (p.get('pitchRatio') as AudioParam).setValueAtTime(Math.pow(2, pitchSemitones / 12), t);
  }

  setModulation(s: ModState): void {
    const p = this.mdNode.parameters as Map<string, AudioParam>, t = this.ctx.currentTime;
    const modes: { [k: string]: number } = { fl: 0, ch: 1, ph: 2 };
    (p.get('mode') as AudioParam).setValueAtTime(modes[s.mode] ?? 0, t);
    (p.get('rate') as AudioParam).setValueAtTime(s.rate, t);
    (p.get('depth') as AudioParam).setValueAtTime(s.depth, t);
    (p.get('feedback') as AudioParam).setValueAtTime(s.fb, t);
    (p.get('mix') as AudioParam).setValueAtTime(s.mix, t);
    (p.get('enabled') as AudioParam).setValueAtTime(s.en ? 1 : 0, t);
  }

  setCompressor(s: CompState): void {
    const p = this.cpNode.parameters as Map<string, AudioParam>, t = this.ctx.currentTime;
    (p.get('threshold') as AudioParam).setValueAtTime(s.thr, t);
    (p.get('ratio') as AudioParam).setValueAtTime(s.rat, t);
    (p.get('attack') as AudioParam).setValueAtTime(s.atk, t);
    (p.get('release') as AudioParam).setValueAtTime(s.rel, t);
    (p.get('makeup') as AudioParam).setValueAtTime(s.mkup, t);
    (p.get('enabled') as AudioParam).setValueAtTime(s.en ? 1 : 0, t);
  }

  detectPitch(): { hz: number; note: string; cents: number } | null {
    if (!this._ready) return null;
    const n = this.analyser.fftSize;
    const buf = new Float32Array(n);
    this.analyser.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.01) return null;
    let r1 = 0, r2 = n - 1;
    for (let i = 0; i < n / 2 && buf[i] < 0.2; i++) r1 = i;
    for (let i = 1; i < n / 2 && buf[n - 1 - i] < 0.2; i++) r2 = n - 1 - i;
    const trimBuf = buf.slice(r1, r2 + 1);
    const tLen = trimBuf.length;
    const c = new Float32Array(tLen);
    for (let i = 0; i < tLen; i++) {
      for (let j = 0; j < tLen - i; j++) c[i] += trimBuf[j] * trimBuf[j + i];
    }
    let d = false, maxVal = -1, maxPos = -1;
    for (let i = 1; i < c.length; i++) {
      if (c[i] > c[i - 1]) d = true;
      if (d && c[i] < c[i - 1]) {
        if (c[i - 1] > maxVal) { maxVal = c[i - 1]; maxPos = i - 1; }
        d = false;
      }
    }
    if (maxPos < 2 || maxVal < 0.01) return null;
    const x1 = maxPos - 1, x2 = maxPos, x3 = Math.min(maxPos + 1, c.length - 1);
    const a = c[x1] - 2 * c[x2] + c[x3];
    const refined = a !== 0 ? maxPos - (c[x3] - c[x1]) / (2 * a) : maxPos;
    const hz = this.ctx.sampleRate / refined;
    if (hz < 60 || hz > 2000) return null;
    const semitones = 12 * Math.log2(hz / 440);
    const midiNote = Math.round(semitones) + 69;
    const cents = Math.round((semitones - (midiNote - 69)) * 100);
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const note = names[((midiNote % 12) + 12) % 12] + Math.floor(midiNote / 12 - 1);
    return { hz: Math.round(hz * 10) / 10, note, cents };
  }

  async startMic(): Promise<void> {
    if (this.micSource) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    this.micStream = stream;
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.fmNode);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  stopMic(): void {
    if (this.micSource) { this.micSource.disconnect(); this.micSource = null; }
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
  }

  async detectBPM(arrayBuffer: ArrayBuffer): Promise<void> {
    const jobId = ++this._bpmJobId;
    if (this.bpmWorker) { this.bpmWorker.terminate(); this.bpmWorker = null; }
    const decoded = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    if (jobId !== this._bpmJobId) return;
    const ch = decoded.getChannelData(0).slice();
    const blob = new Blob([BPM_WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    this.bpmWorker = new Worker(url);
    URL.revokeObjectURL(url);
    this.bpmWorker.postMessage({ sampleRate: decoded.sampleRate, channel: ch }, [ch.buffer]);
    this.bpmWorker.onmessage = (e) => {
      if (e.data.type === 'bpm' && jobId === this._bpmJobId) {
        this.emit({ type: 'bpm', value: e.data.value });
      }
      this.bpmWorker?.terminate();
      this.bpmWorker = null;
    };
  }

  async renderOffline(
    audioData: ArrayBuffer,
    pitchSemitones: number,
    tempoFactor: number,
    eqGains: number[],
    vocalCancel: boolean,
    bitcrusher: { bits: number; reduction: number; enabled: boolean },
    reverbWet: number,
  ): Promise<AudioBuffer> {
    const tempCtx = new OfflineAudioContext(2, 1, 44100);
    const decoded = await tempCtx.decodeAudioData(audioData.slice(0));
    const outDuration = decoded.duration / tempoFactor;
    const outLength = Math.ceil(outDuration * decoded.sampleRate);
    const offCtx = new OfflineAudioContext(decoded.numberOfChannels, outLength, decoded.sampleRate);

    await Promise.all([
      this.registerWorkletOnCtx(offCtx, PHASE_VOCODER_CODE),
      this.registerWorkletOnCtx(offCtx, FORMANT_CODE),
      this.registerWorkletOnCtx(offCtx, BITCRUSHER_CODE),
      this.registerWorkletOnCtx(offCtx, VOCAL_CANCEL_CODE),
      this.registerWorkletOnCtx(offCtx, MODULATION_CODE),
      this.registerWorkletOnCtx(offCtx, COMPRESSOR_CODE),
    ]);
    const nCh = decoded.numberOfChannels;
    const oW = (ni: number, no: number): AudioWorkletNodeOptions => ({ numberOfInputs: ni, numberOfOutputs: no, outputChannelCount: [nCh] });
    const pvNode = new AudioWorkletNode(offCtx, 'phase-vocoder-processor', oW(0, 1));
    const fmNode = new AudioWorkletNode(offCtx, 'formant-processor', oW(1, 1));
    const vcNode = new AudioWorkletNode(offCtx, 'vocal-cancel-processor', oW(1, 1));
    const mdNode = new AudioWorkletNode(offCtx, 'mod-processor', oW(1, 1));
    const bcNode = new AudioWorkletNode(offCtx, 'bitcrusher-processor', oW(1, 1));
    const cpNode = new AudioWorkletNode(offCtx, 'comp-processor', oW(1, 1));

    const eqs = DEFAULT_EQ_BANDS.map((freq, i) => {
      const f = offCtx.createBiquadFilter();
      if (i === 0) f.type = 'lowshelf';
      else if (i === DEFAULT_EQ_BANDS.length - 1) f.type = 'highshelf';
      else { f.type = 'peaking'; f.Q.value = 1.4; }
      f.frequency.value = freq;
      f.gain.value = eqGains[i] ?? 0;
      return f;
    });

    const conv = offCtx.createConvolver();
    conv.buffer = this.createReverbIRCtx(offCtx, 2.5, 3);
    const wetG = offCtx.createGain();
    wetG.gain.value = clamp(reverbWet, 0, 1);
    const dryG = offCtx.createGain();
    dryG.gain.value = 1 - reverbWet * 0.5;
    const mixG = offCtx.createGain();

    let node: AudioNode = pvNode;
    node.connect(fmNode); node = fmNode;
    node.connect(vcNode); node = vcNode;
    for (const eq of eqs) { node.connect(eq); node = eq; }
    node.connect(mdNode); node = mdNode;
    node.connect(bcNode); node = bcNode;
    node.connect(cpNode); node = cpNode;
    node.connect(dryG);
    node.connect(conv);
    conv.connect(wetG);
    dryG.connect(mixG);
    wetG.connect(mixG);
    mixG.connect(offCtx.destination);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      channels.push(decoded.getChannelData(ch).slice());
    }
    pvNode.port.postMessage(
      { type: 'loadBuffer', channels, sampleRate: decoded.sampleRate },
      channels.map(c => c.buffer),
    );
    pvNode.port.postMessage({ type: 'setPitch', semitones: pitchSemitones });
    pvNode.port.postMessage({ type: 'setTempo', tempo: tempoFactor });
    pvNode.port.postMessage({ type: 'play' });

    const vcP = vcNode.parameters as Map<string, AudioParam>;
    (vcP.get('enabled') as AudioParam).setValueAtTime(vocalCancel ? 1 : 0, 0);
    const bcP = bcNode.parameters as Map<string, AudioParam>;
    (bcP.get('bits') as AudioParam).setValueAtTime(bitcrusher.bits, 0);
    (bcP.get('reduction') as AudioParam).setValueAtTime(bitcrusher.reduction, 0);
    (bcP.get('enabled') as AudioParam).setValueAtTime(bitcrusher.enabled ? 1 : 0, 0);
    const fmP = fmNode.parameters as Map<string, AudioParam>;
    (fmP.get('enabled') as AudioParam).setValueAtTime(1, 0);
    (fmP.get('pitchRatio') as AudioParam).setValueAtTime(Math.pow(2, pitchSemitones / 12), 0);

    return offCtx.startRendering();
  }

  private async registerWorkletOnCtx(ctx: AudioContext | OfflineAudioContext, code: string): Promise<void> {
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try { await ctx.audioWorklet.addModule(url); }
    finally { URL.revokeObjectURL(url); }
  }

  private createReverbIR(duration: number, decay: number): AudioBuffer {
    return this.createReverbIRCtx(this.ctx, duration, decay);
  }

  private createReverbIRCtx(ctx: BaseAudioContext, duration: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const ir = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: rate });
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return ir;
  }

  on(handler: EngineEventHandler): void { this.listeners.push(handler); }
  off(handler: EngineEventHandler): void { this.listeners = this.listeners.filter(h => h !== handler); }
  private emit(event: EngineEvent): void { for (const h of this.listeners) h(event); }

  async dispose(): Promise<void> {
    this.stopMic();
    [this.pvNode, this.fmNode, this.vcNode, this.mdNode, this.bcNode, this.cpNode,
    this.convolver, this.masterGain, this.analyser].forEach(n => n?.disconnect());
    this.eqNodes.forEach(n => n.disconnect());
    this.bpmWorker?.terminate();
    await this.ctx?.close();
  }
}
