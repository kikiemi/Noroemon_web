export class Visualizer {
  private canvas: HTMLCanvasElement;
  private worker: Worker | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBuf: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  private timeBuf: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  private raf = 0;
  private _playing = false;
  private mode: 'bars' | 'circular' | 'combined' = 'combined';

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'visualizer-canvas';
    parent.appendChild(this.canvas);

    this.canvas.addEventListener('click', () => {
      const modes: typeof this.mode[] = ['bars', 'circular', 'combined'];
      this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
      this.worker?.postMessage({ type: 'mode', mode: this.mode });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      } else if (this._playing) {
        this.start();
      }
    });

    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth * dpr;
      const h = this.canvas.clientHeight * dpr;
      if (this.worker) {
        this.worker.postMessage({ type: 'resize', w, h });
      } else {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    });
    ro.observe(this.canvas);
  }

  connect(analyser: AnalyserNode, _audioCtx: AudioContext): void {
    this.analyser = analyser;
    this.freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.timeBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));

    const WORKER_CODE = `(${workerFn.toString()})()`;
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      const offscreen = this.canvas.transferControlToOffscreen();
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      const dpr = window.devicePixelRatio || 1;
      this.worker.postMessage({ type: 'init', canvas: offscreen, w: this.canvas.clientWidth * dpr, h: this.canvas.clientHeight * dpr }, [offscreen as unknown as Transferable]);
      this.worker.postMessage({ type: 'mode', mode: this.mode });
    } catch {
      URL.revokeObjectURL(url);
      this.worker = null;
    }
  }

  setPlaying(v: boolean): void {
    this._playing = v;
    if (v) { this.start(); } else { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } }
  }

  private start(): void {
    if (this.raf || !this.analyser) return;
    const draw = () => {
      if (!this._playing || document.hidden) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(draw);
      this.analyser!.getByteFrequencyData(this.freqBuf);
      this.analyser!.getByteTimeDomainData(this.timeBuf);
      if (this.worker) {
        this.worker.postMessage({ type: 'draw', freq: this.freqBuf, time: this.timeBuf });
      }
    };
    this.raf = requestAnimationFrame(draw);
  }
}

function workerFn(): void {
  interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; hue: number; }
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let W = 0, H = 0;
  let mode = 'combined';
  let hueOffset = 0;
  const pts: Particle[] = [];

  function spawnP(x: number, y: number, h: number): void {
    if (pts.length >= 150) return;
    pts.push({ x, y, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 3 - 1, life: 1, size: Math.random() * 3 + 1, hue: h });
  }

  function drawBars(f: Uint8Array, w: number, h: number, c: OffscreenCanvasRenderingContext2D): void {
    const n = f.length, bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = f[i] / 255, bh = v * h, hue = (hueOffset + (i / n) * 220) % 360;
      c.fillStyle = `hsl(${hue},80%,${40 + v * 30}%)`;
      c.fillRect(i * bw, h - bh, bw - 0.5, bh);
      if (v > 0.85 && Math.random() < 0.08) spawnP(i * bw + bw / 2, h - bh, hue);
    }
  }

  function drawCirc(f: Uint8Array, t: Uint8Array, w: number, h: number, c: OffscreenCanvasRenderingContext2D): void {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.3, n = f.length;
    c.strokeStyle = `hsla(${hueOffset},70%,55%,0.35)`; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, amp = (f[i] / 255) * r * 0.7;
      i === 0 ? c.moveTo(cx + Math.cos(a) * (r + amp), cy + Math.sin(a) * (r + amp)) : c.lineTo(cx + Math.cos(a) * (r + amp), cy + Math.sin(a) * (r + amp));
    }
    c.closePath(); c.stroke();
    c.strokeStyle = `hsla(${(hueOffset + 120) % 360},60%,60%,0.5)`; c.lineWidth = 1.5; c.beginPath();
    const tn = t.length;
    for (let i = 0; i < tn; i++) {
      const a = (i / tn) * Math.PI * 2, amp = ((t[i] - 128) / 128) * r * 0.4;
      i === 0 ? c.moveTo(cx + Math.cos(a) * (r * 0.5 + amp), cy + Math.sin(a) * (r * 0.5 + amp)) : c.lineTo(cx + Math.cos(a) * (r * 0.5 + amp), cy + Math.sin(a) * (r * 0.5 + amp));
    }
    c.closePath(); c.stroke();
  }

  self.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    if (msg.type === 'init') { canvas = msg.canvas; ctx = canvas!.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D; if (msg.w) { canvas!.width = msg.w; canvas!.height = msg.h; W = msg.w; H = msg.h; } }
    if (msg.type === 'resize' && canvas) { canvas.width = msg.w; canvas.height = msg.h; W = msg.w; H = msg.h; }
    if (msg.type === 'mode') mode = msg.mode;
    if (msg.type === 'draw' && ctx && W > 0 && H > 0) {
      const f: Uint8Array = msg.freq, t: Uint8Array = msg.time;
      hueOffset = (hueOffset + 0.3) % 360;
      ctx.fillStyle = 'rgba(10,10,18,0.25)'; ctx.fillRect(0, 0, W, H);
      if (mode === 'bars' || mode === 'combined') drawBars(f, W, mode === 'combined' ? H / 2 : H, ctx);
      if (mode === 'circular' || mode === 'combined') { ctx.save(); if (mode === 'combined') ctx.translate(0, H / 2); drawCirc(f, t, W, mode === 'combined' ? H / 2 : H, ctx); ctx.restore(); }
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i]; p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= 0.025;
        if (p.life <= 0) { pts.splice(i, 1); continue; }
        ctx.globalAlpha = p.life; ctx.fillStyle = `hsl(${p.hue},90%,70%)`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  };
}
