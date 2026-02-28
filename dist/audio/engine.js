import { DEFAULT_EQ_BANDS, clamp } from '../types.js';
import { PHASE_VOCODER_CODE, BITCRUSHER_CODE, VOCAL_CANCEL_CODE, FORMANT_CODE, MODULATION_CODE, COMPRESSOR_CODE } from './worklet-code.js';
import { BPM_WORKER_CODE } from './bpm-worker-code.js';
export class AudioEngine {
    ctx;
    pvNode;
    fmNode;
    vcNode;
    bcNode;
    mdNode;
    cpNode;
    eqNodes = [];
    convolver;
    reverbWet;
    reverbDry;
    reverbMix;
    masterGain;
    analyser;
    bpmWorker = null;
    micSource = null;
    micStream = null;
    listeners = [];
    _ready = false;
    _duration = 0;
    _sampleRate = 44100;
    _bpmJobId = 0;
    get ready() { return this._ready; }
    get duration() { return this._duration; }
    get sampleRate() { return this._sampleRate; }
    get audioContext() { return this.ctx; }
    get micActive() { return this.micSource !== null; }
    async init() {
        this.ctx = new AudioContext({ sampleRate: 44100 });
        await Promise.all([
            this.registerWorklet(PHASE_VOCODER_CODE),
            this.registerWorklet(FORMANT_CODE),
            this.registerWorklet(BITCRUSHER_CODE),
            this.registerWorklet(VOCAL_CANCEL_CODE),
            this.registerWorklet(MODULATION_CODE),
            this.registerWorklet(COMPRESSOR_CODE),
        ]);
        const wOpt = (n, o) => ({ numberOfInputs: n, numberOfOutputs: o, outputChannelCount: [2] });
        this.pvNode = new AudioWorkletNode(this.ctx, 'phase-vocoder-processor', wOpt(0, 1));
        this.fmNode = new AudioWorkletNode(this.ctx, 'formant-processor', wOpt(1, 1));
        this.vcNode = new AudioWorkletNode(this.ctx, 'vocal-cancel-processor', wOpt(1, 1));
        this.mdNode = new AudioWorkletNode(this.ctx, 'mod-processor', wOpt(1, 1));
        this.bcNode = new AudioWorkletNode(this.ctx, 'bitcrusher-processor', wOpt(1, 1));
        this.cpNode = new AudioWorkletNode(this.ctx, 'comp-processor', wOpt(1, 1));
        this.eqNodes = DEFAULT_EQ_BANDS.map((freq, i) => {
            const f = this.ctx.createBiquadFilter();
            if (i === 0) {
                f.type = 'lowshelf';
            }
            else if (i === DEFAULT_EQ_BANDS.length - 1) {
                f.type = 'highshelf';
            }
            else {
                f.type = 'peaking';
                f.Q.value = 1.4;
            }
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
        let node = this.pvNode;
        node.connect(this.fmNode);
        node = this.fmNode;
        node.connect(this.vcNode);
        node = this.vcNode;
        for (const eq of this.eqNodes) {
            node.connect(eq);
            node = eq;
        }
        node.connect(this.mdNode);
        node = this.mdNode;
        node.connect(this.bcNode);
        node = this.bcNode;
        node.connect(this.cpNode);
        node = this.cpNode;
        node.connect(this.reverbDry);
        node.connect(this.convolver);
        this.convolver.connect(this.reverbWet);
        this.reverbDry.connect(this.reverbMix);
        this.reverbWet.connect(this.reverbMix);
        this.reverbMix.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        this.pvNode.port.onmessage = (e) => {
            const d = e.data;
            if (d.type === 'position') {
                this.emit({ type: 'position', current: d.position, total: d.total });
            }
            else if (d.type === 'ended') {
                this.emit({ type: 'ended' });
            }
            else if (d.type === 'loaded') {
                this._duration = d.duration;
                this.emit({ type: 'loaded', duration: d.duration });
            }
        };
        this._ready = true;
    }
    async registerWorklet(code) {
        const blob = new Blob([code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
            await this.ctx.audioWorklet.addModule(url);
        }
        finally {
            URL.revokeObjectURL(url);
        }
    }
    async loadBuffer(audioBuffer) {
        if (this.ctx.state === 'suspended')
            await this.ctx.resume();
        this._sampleRate = audioBuffer.sampleRate;
        this._duration = audioBuffer.duration;
        const channels = [];
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
            channels.push(audioBuffer.getChannelData(ch).slice());
        }
        this.pvNode.port.postMessage({ type: 'loadBuffer', channels, sampleRate: audioBuffer.sampleRate }, channels.map(c => c.buffer));
    }
    play() {
        if (this.ctx.state === 'suspended')
            this.ctx.resume();
        this.pvNode.port.postMessage({ type: 'play' });
    }
    pause() { this.pvNode.port.postMessage({ type: 'pause' }); }
    stop() { this.pvNode.port.postMessage({ type: 'stop' }); }
    seek(seconds) { this.pvNode.port.postMessage({ type: 'seek', position: seconds * this._sampleRate }); }
    setPitch(semitones) { this.pvNode.port.postMessage({ type: 'setPitch', semitones: clamp(semitones, -24, 24) }); }
    setTempo(factor) { this.pvNode.port.postMessage({ type: 'setTempo', tempo: clamp(factor, 0.25, 4) }); }
    setVolume(v) { this.masterGain.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.02); }
    setLoop(startSec, endSec) { this.pvNode.port.postMessage({ type: 'setLoop', start: startSec, end: endSec }); }
    clearLoop() { this.pvNode.port.postMessage({ type: 'clearLoop' }); }
    setEQBand(index, gainDb) {
        if (this.eqNodes[index]) {
            this.eqNodes[index].gain.setTargetAtTime(clamp(gainDb, -12, 12), this.ctx.currentTime, 0.02);
        }
    }
    setEQAll(gains) { gains.forEach((g, i) => this.setEQBand(i, g)); }
    setReverb(wet) {
        const w = clamp(wet, 0, 1);
        this.reverbWet.gain.setTargetAtTime(w, this.ctx.currentTime, 0.03);
        this.reverbDry.gain.setTargetAtTime(1 - w * 0.5, this.ctx.currentTime, 0.03);
    }
    setBitcrusher(bits, reduction, enabled) {
        const p = this.bcNode.parameters;
        const t = this.ctx.currentTime;
        p.get('bits').setValueAtTime(clamp(bits, 1, 16), t);
        p.get('reduction').setValueAtTime(clamp(reduction, 1, 64), t);
        p.get('enabled').setValueAtTime(enabled ? 1 : 0, t);
    }
    setVocalCancel(enabled) {
        const p = this.vcNode.parameters;
        p.get('enabled').setValueAtTime(enabled ? 1 : 0, this.ctx.currentTime);
    }
    setReverse() { this.pvNode.port.postMessage({ type: 'reverse' }); }
    setFormant(enabled, pitchSemitones) {
        const p = this.fmNode.parameters, t = this.ctx.currentTime;
        p.get('enabled').setValueAtTime(enabled ? 1 : 0, t);
        p.get('pitchRatio').setValueAtTime(Math.pow(2, pitchSemitones / 12), t);
    }
    setModulation(s) {
        const p = this.mdNode.parameters, t = this.ctx.currentTime;
        const modes = { fl: 0, ch: 1, ph: 2 };
        p.get('mode').setValueAtTime(modes[s.mode] ?? 0, t);
        p.get('rate').setValueAtTime(s.rate, t);
        p.get('depth').setValueAtTime(s.depth, t);
        p.get('feedback').setValueAtTime(s.fb, t);
        p.get('mix').setValueAtTime(s.mix, t);
        p.get('enabled').setValueAtTime(s.en ? 1 : 0, t);
    }
    setCompressor(s) {
        const p = this.cpNode.parameters, t = this.ctx.currentTime;
        p.get('threshold').setValueAtTime(s.thr, t);
        p.get('ratio').setValueAtTime(s.rat, t);
        p.get('attack').setValueAtTime(s.atk, t);
        p.get('release').setValueAtTime(s.rel, t);
        p.get('makeup').setValueAtTime(s.mkup, t);
        p.get('enabled').setValueAtTime(s.en ? 1 : 0, t);
    }
    detectPitch() {
        if (!this._ready)
            return null;
        const n = this.analyser.fftSize;
        const buf = new Float32Array(n);
        this.analyser.getFloatTimeDomainData(buf);
        let rms = 0;
        for (let i = 0; i < n; i++)
            rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / n);
        if (rms < 0.01)
            return null;
        let r1 = 0, r2 = n - 1;
        for (let i = 0; i < n / 2 && buf[i] < 0.2; i++)
            r1 = i;
        for (let i = 1; i < n / 2 && buf[n - 1 - i] < 0.2; i++)
            r2 = n - 1 - i;
        const trimBuf = buf.slice(r1, r2 + 1);
        const tLen = trimBuf.length;
        const c = new Float32Array(tLen);
        for (let i = 0; i < tLen; i++) {
            for (let j = 0; j < tLen - i; j++)
                c[i] += trimBuf[j] * trimBuf[j + i];
        }
        let d = false, maxVal = -1, maxPos = -1;
        for (let i = 1; i < c.length; i++) {
            if (c[i] > c[i - 1])
                d = true;
            if (d && c[i] < c[i - 1]) {
                if (c[i - 1] > maxVal) {
                    maxVal = c[i - 1];
                    maxPos = i - 1;
                }
                d = false;
            }
        }
        if (maxPos < 2 || maxVal < 0.01)
            return null;
        const x1 = maxPos - 1, x2 = maxPos, x3 = Math.min(maxPos + 1, c.length - 1);
        const a = c[x1] - 2 * c[x2] + c[x3];
        const refined = a !== 0 ? maxPos - (c[x3] - c[x1]) / (2 * a) : maxPos;
        const hz = this.ctx.sampleRate / refined;
        if (hz < 60 || hz > 2000)
            return null;
        const semitones = 12 * Math.log2(hz / 440);
        const midiNote = Math.round(semitones) + 69;
        const cents = Math.round((semitones - (midiNote - 69)) * 100);
        const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const note = names[((midiNote % 12) + 12) % 12] + Math.floor(midiNote / 12 - 1);
        return { hz: Math.round(hz * 10) / 10, note, cents };
    }
    async startMic() {
        if (this.micSource)
            return;
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        this.micStream = stream;
        this.micSource = this.ctx.createMediaStreamSource(stream);
        this.micSource.connect(this.fmNode);
        if (this.ctx.state === 'suspended')
            await this.ctx.resume();
    }
    stopMic() {
        if (this.micSource) {
            this.micSource.disconnect();
            this.micSource = null;
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop());
            this.micStream = null;
        }
    }
    async detectBPM(arrayBuffer) {
        const jobId = ++this._bpmJobId;
        if (this.bpmWorker) {
            this.bpmWorker.terminate();
            this.bpmWorker = null;
        }
        const decoded = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
        if (jobId !== this._bpmJobId)
            return;
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
    async renderOffline(audioData, pitchSemitones, tempoFactor, eqGains, vocalCancel, bitcrusher, reverbWet) {
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
        const oW = (ni, no) => ({ numberOfInputs: ni, numberOfOutputs: no, outputChannelCount: [nCh] });
        const pvNode = new AudioWorkletNode(offCtx, 'phase-vocoder-processor', oW(0, 1));
        const fmNode = new AudioWorkletNode(offCtx, 'formant-processor', oW(1, 1));
        const vcNode = new AudioWorkletNode(offCtx, 'vocal-cancel-processor', oW(1, 1));
        const mdNode = new AudioWorkletNode(offCtx, 'mod-processor', oW(1, 1));
        const bcNode = new AudioWorkletNode(offCtx, 'bitcrusher-processor', oW(1, 1));
        const cpNode = new AudioWorkletNode(offCtx, 'comp-processor', oW(1, 1));
        const eqs = DEFAULT_EQ_BANDS.map((freq, i) => {
            const f = offCtx.createBiquadFilter();
            if (i === 0)
                f.type = 'lowshelf';
            else if (i === DEFAULT_EQ_BANDS.length - 1)
                f.type = 'highshelf';
            else {
                f.type = 'peaking';
                f.Q.value = 1.4;
            }
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
        let node = pvNode;
        node.connect(fmNode);
        node = fmNode;
        node.connect(vcNode);
        node = vcNode;
        for (const eq of eqs) {
            node.connect(eq);
            node = eq;
        }
        node.connect(mdNode);
        node = mdNode;
        node.connect(bcNode);
        node = bcNode;
        node.connect(cpNode);
        node = cpNode;
        node.connect(dryG);
        node.connect(conv);
        conv.connect(wetG);
        dryG.connect(mixG);
        wetG.connect(mixG);
        mixG.connect(offCtx.destination);
        const channels = [];
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
            channels.push(decoded.getChannelData(ch).slice());
        }
        pvNode.port.postMessage({ type: 'loadBuffer', channels, sampleRate: decoded.sampleRate }, channels.map(c => c.buffer));
        pvNode.port.postMessage({ type: 'setPitch', semitones: pitchSemitones });
        pvNode.port.postMessage({ type: 'setTempo', tempo: tempoFactor });
        pvNode.port.postMessage({ type: 'play' });
        const vcP = vcNode.parameters;
        vcP.get('enabled').setValueAtTime(vocalCancel ? 1 : 0, 0);
        const bcP = bcNode.parameters;
        bcP.get('bits').setValueAtTime(bitcrusher.bits, 0);
        bcP.get('reduction').setValueAtTime(bitcrusher.reduction, 0);
        bcP.get('enabled').setValueAtTime(bitcrusher.enabled ? 1 : 0, 0);
        const fmP = fmNode.parameters;
        fmP.get('enabled').setValueAtTime(1, 0);
        fmP.get('pitchRatio').setValueAtTime(Math.pow(2, pitchSemitones / 12), 0);
        return offCtx.startRendering();
    }
    async registerWorkletOnCtx(ctx, code) {
        const blob = new Blob([code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
            await ctx.audioWorklet.addModule(url);
        }
        finally {
            URL.revokeObjectURL(url);
        }
    }
    createReverbIR(duration, decay) {
        return this.createReverbIRCtx(this.ctx, duration, decay);
    }
    createReverbIRCtx(ctx, duration, decay) {
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
    on(handler) { this.listeners.push(handler); }
    off(handler) { this.listeners = this.listeners.filter(h => h !== handler); }
    emit(event) { for (const h of this.listeners)
        h(event); }
    async dispose() {
        this.stopMic();
        [this.pvNode, this.fmNode, this.vcNode, this.mdNode, this.bcNode, this.cpNode,
            this.convolver, this.masterGain, this.analyser].forEach(n => n?.disconnect());
        this.eqNodes.forEach(n => n.disconnect());
        this.bpmWorker?.terminate();
        await this.ctx?.close();
    }
}
//# sourceMappingURL=engine.js.map