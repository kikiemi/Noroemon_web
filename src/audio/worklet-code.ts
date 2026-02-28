export const PHASE_VOCODER_CODE = `
'use strict';

const FFT_N  = 2048;
const HOP_A  = 512;
const RING   = 1 << 19;
const RING_M = RING - 1;
const LUT_N  = 65536;
const TWO_PI = Math.PI * 2;
const HALF_N = FFT_N >> 1;

const SIN_LUT = new Float32Array(LUT_N);
const COS_LUT = new Float32Array(LUT_N);
for (let i = 0; i < LUT_N; i++) {
  const a = (i / LUT_N) * TWO_PI;
  SIN_LUT[i] = Math.sin(a);
  COS_LUT[i] = Math.cos(a);
}

const BIT_REV = new Uint16Array(FFT_N);
(function() {
  const bits = Math.log2(FFT_N) | 0;
  for (let i = 0; i < FFT_N; i++) {
    let r = 0, x = i;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    BIT_REV[i] = r;
  }
})();

const TW_RE = new Float32Array(HALF_N);
const TW_IM = new Float32Array(HALF_N);
for (let k = 0; k < HALF_N; k++) {
  const a = -TWO_PI * k / FFT_N;
  TW_RE[k] = Math.cos(a);
  TW_IM[k] = Math.sin(a);
}

const HANN = new Float32Array(FFT_N);
for (let i = 0; i < FFT_N; i++) HANN[i] = 0.5 * (1 - Math.cos(TWO_PI * i / (FFT_N - 1)));

const OLA_NORM = (function() {
  const s = new Float32Array(HOP_A);
  for (let i = 0; i < FFT_N; i++) s[i % HOP_A] += HANN[i] * HANN[i];
  let mn = s[0];
  for (let i = 1; i < HOP_A; i++) if (s[i] < mn) mn = s[i];
  return mn > 1e-9 ? mn : 1;
})();

const DPHI = new Float32Array(FFT_N);
for (let k = 0; k < FFT_N; k++) DPHI[k] = TWO_PI * k * HOP_A / FFT_N;

function fft(re, im) {
  for (let i = 0; i < FFT_N; i++) {
    const j = BIT_REV[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let s = 1; s < FFT_N; s <<= 1) {
    const stride = HALF_N / s;
    for (let k = 0; k < FFT_N; k += s << 1) {
      for (let j = 0; j < s; j++) {
        const tw = j * stride;
        const wr = TW_RE[tw], wi = TW_IM[tw];
        const u = k + j, v = u + s;
        const tr = wr * re[v] - wi * im[v];
        const ti = wr * im[v] + wi * re[v];
        re[v] = re[u] - tr;  im[v] = im[u] - ti;
        re[u] += tr;         im[u] += ti;
      }
    }
  }
}

function ifft(re, im) {
  for (let i = 0; i < FFT_N; i++) im[i] = -im[i];
  fft(re, im);
  const inv = 1.0 / FFT_N;
  for (let i = 0; i < FFT_N; i++) { re[i] *= inv; im[i] = -im[i] * inv; }
}

class PhaseVocoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ch = [];  this._nCh = 0;  this._len = 0;
    this._inPos = 0;  this._pitch = 1.0;  this._tempo = 1.0;
    this._loopS = -1;  this._loopE = -1;  this._playing = false;
    this._sr = sampleRate;

    this._re  = [new Float32Array(FFT_N), new Float32Array(FFT_N)];
    this._im  = [new Float32Array(FFT_N), new Float32Array(FFT_N)];
    this._phA = [new Float32Array(FFT_N), new Float32Array(FFT_N)];
    this._phS = [new Float32Array(FFT_N), new Float32Array(FFT_N)];
    this._mag = [new Float32Array(FFT_N), new Float32Array(FFT_N)];

    this._ring = [new Float32Array(RING), new Float32Array(RING)];
    this._sPos = 0.0;
    this._rPos = 0.0;

    this._rptCnt = 0;
    this.port.onmessage = (e) => this._msg(e.data);
  }

  _msg(d) {
    switch (d.type) {
      case 'loadBuffer':
        this._ch = d.channels;  this._nCh = this._ch.length;
        this._len = this._ch[0].length;  this._inPos = 0;  this._reset();
        this.port.postMessage({ type: 'loaded', duration: this._len / this._sr });
        break;
      case 'play':   this._playing = true;  break;
      case 'pause':  this._playing = false; break;
      case 'stop':   this._playing = false; this._inPos = 0; this._reset(); break;
      case 'seek':
        this._inPos = Math.max(0, Math.min(Math.floor(d.position), this._len - 1));
        this._reset(); break;
      case 'setPitch':  this._pitch = Math.pow(2, d.semitones / 12); break;
      case 'setTempo':  this._tempo = Math.max(0.25, Math.min(4.0, d.tempo)); break;
      case 'setLoop':
        this._loopS = Math.floor(d.start * this._sr);
        this._loopE = Math.floor(d.end   * this._sr); break;
      case 'clearLoop': this._loopS = -1; this._loopE = -1; break;
      case 'reverse':
        for (let c = 0; c < this._nCh; c++) this._ch[c].reverse();
        this._inPos = Math.max(0, this._len - 1 - this._inPos);
        this._reset(); break;
    }
  }

  _reset() {
    for (let c = 0; c < 2; c++) {
      this._ring[c].fill(0);
      this._phA[c].fill(0);  this._phS[c].fill(0);
      this._mag[c].fill(0);
    }
    this._sPos = 0.0;  this._rPos = 0.0;
  }

  process(_ins, outs, _p) {
    const out = outs[0];
    const N   = out[0].length;

    if (!this._playing || this._nCh === 0) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }

    // FIX 1: Float-accurate hop — prevents tempo drift from integer rounding
    const exactHopS = HOP_A * this._pitch / this._tempo;
    const requiredSp = this._rPos + N * this._pitch + Math.max(exactHopS, HOP_A) * 4;

    while (this._sPos < requiredSp) {
      if (!this._grain(exactHopS)) break;
    }

    // Resampling: read ring at pitch rate (this IS the pitch shift)
    const startR = Math.floor(this._rPos);
    for (let i = 0; i < N; i++) {
      const rp = this._rPos;
      const r0 = Math.floor(rp) & RING_M;
      const r1 = (r0 + 1) & RING_M;
      const fr = rp - Math.floor(rp);

      for (let c = 0; c < out.length; c++) {
        const chIdx = c < this._nCh ? c : 0;
        const s0 = this._ring[chIdx][r0];
        const s1 = this._ring[chIdx][r1];
        out[c][i] = s0 + (s1 - s0) * fr;
      }
      this._rPos += this._pitch;
    }

    const endR = Math.floor(this._rPos);
    for (let r = startR; r < endR; r++) {
      const ri = r & RING_M;
      this._ring[0][ri] = 0;  this._ring[1][ri] = 0;
    }

    this._rptCnt += N;
    if (this._rptCnt >= 2048) {
      this._rptCnt = 0;
      this.port.postMessage({ type: 'position',
        position: this._inPos / this._sr, total: this._len / this._sr });
    }
    return true;
  }

  _grain(exactHopS) {
    if (this._inPos + FFT_N >= this._len) {
      if (this._loopE > 0 && this._loopS >= 0) { this._inPos = this._loopS; }
      else {
        this._playing = false;
        this.port.postMessage({ type: 'ended' });
        return false;
      }
    }

    const nCh  = Math.min(this._nCh, 2);
    const base  = this._inPos;
    const isIdentity = Math.abs(this._pitch - 1.0) < 0.001 && Math.abs(this._tempo - 1.0) < 0.001;

    for (let c = 0; c < nCh; c++) {
      const inp  = this._ch[c];
      const ring = this._ring[c];
      const sp   = Math.floor(this._sPos);

      if (isIdentity) {
        // Identity bypass: HANN^2 OLA = perfect reconstruction, zero algorithmic coloring
        for (let i = 0; i < FFT_N; i++) {
          const si = base + i;
          const s  = si < this._len ? inp[si] * HANN[i] * HANN[i] : 0;
          ring[(sp + i) & RING_M] += s / OLA_NORM;
        }
      } else {
        const re   = this._re[c],  im  = this._im[c];
        const phA  = this._phA[c], phS = this._phS[c];
        const mag  = this._mag[c];

        for (let i = 0; i < FFT_N; i++) {
          const si = base + i;
          re[i] = si < this._len ? inp[si] * HANN[i] : 0;
          im[i] = 0;
        }
        fft(re, im);

        for (let k = 0; k < FFT_N; k++) {
          mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
          const ap = Math.atan2(im[k], re[k]);
          let dp = ap - phA[k] - DPHI[k];
          dp -= TWO_PI * Math.round(dp / TWO_PI);
          phA[k]  = ap;
          phS[k] += exactHopS * (DPHI[k] + dp) / HOP_A;
        }

        // Phase locking: nearest-peak identity
        const peakOf = new Int16Array(FFT_N).fill(-1);
        for (let k = 1; k < HALF_N - 1; k++) {
          if (mag[k] > mag[k - 1] && mag[k] > mag[k + 1] && mag[k] > 1e-7) {
            peakOf[k] = k;
            for (let j = k - 1; j >= 0 && peakOf[j] < 0; j--) {
              if (mag[j] > mag[k]) break;
              peakOf[j] = k;
            }
          }
        }
        let lastPk = -1;
        for (let k = HALF_N - 1; k >= 0; k--) {
          if (peakOf[k] === k) { lastPk = k; }
          else if (peakOf[k] < 0 && lastPk >= 0) { peakOf[k] = lastPk; }
        }
        for (let k = 0; k < HALF_N; k++) {
          const pk = peakOf[k];
          if (pk >= 0 && pk !== k) { phS[k] = phS[pk] + (phA[k] - phA[pk]); }
          phS[FFT_N - k] = -phS[k];
        }

        for (let k = 0; k < FFT_N; k++) {
          let iph = ((phS[k] * (LUT_N / TWO_PI)) | 0) % LUT_N;
          if (iph < 0) iph += LUT_N;
          re[k] = mag[k] * COS_LUT[iph];
          im[k] = mag[k] * SIN_LUT[iph];
        }
        ifft(re, im);

        for (let i = 0; i < FFT_N; i++) {
          ring[(sp + i) & RING_M] += re[i] * HANN[i] / OLA_NORM;
        }
      }
    }

    if (nCh === 1) {
      const sp = Math.floor(this._sPos);
      for (let i = 0; i < FFT_N; i++) {
        const ri = (sp + i) & RING_M;
        this._ring[1][ri] = this._ring[0][ri];
      }
    }

    this._inPos += HOP_A;
    this._sPos  += exactHopS; // float advance — the key to tempo accuracy
    if (this._loopE > 0 && this._inPos >= this._loopE) this._inPos = this._loopS;
    return true;
  }
}

registerProcessor('phase-vocoder-processor', PhaseVocoderProcessor);
`;


export const BITCRUSHER_CODE = `
'use strict';
class BitCrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'reduction', defaultValue: 1, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this._hold = [0, 0];
    this._cnt = 0;
  }
  process(ins, outs, params) {
    const input = ins[0];
    const output = outs[0];
    if (!input || !input[0]) return true;
    const enabled = (params.enabled[0] ?? 0) >= 0.5;
    if (!enabled) {
      for (let c = 0; c < output.length; c++) {
        if (input[c]) output[c].set(input[c]);
      }
      return true;
    }
    const bits = params.bits[0] ?? 16;
    const red = Math.max(1, Math.floor(params.reduction[0] ?? 1));
    const step = Math.pow(0.5, bits);
    for (let c = 0; c < output.length; c++) {
      const inp = input[c] || input[0];
      const out = output[c];
      for (let i = 0; i < out.length; i++) {
        this._cnt++;
        if (this._cnt >= red) {
          this._cnt = 0;
          this._hold[c] = Math.round(inp[i] / step) * step;
        }
        out[i] = this._hold[c];
      }
    }
    return true;
  }
}
registerProcessor('bitcrusher-processor', BitCrusherProcessor);
`;


export const VOCAL_CANCEL_CODE = `
'use strict';
class VocalCancelProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'enabled', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  process(ins, outs, params) {
    const input = ins[0];
    const output = outs[0];
    if (!input || !input[0]) return true;
    const enabled = (params.enabled[0] ?? 0) >= 0.5;
    if (!enabled || input.length < 2) {
      for (let c = 0; c < output.length; c++) {
        if (input[c]) output[c].set(input[c]);
        else if (input[0]) output[c].set(input[0]);
      }
      return true;
    }
    const L = input[0], R = input[1];
    for (let i = 0; i < L.length; i++) {
      const diff = (L[i] - R[i]) * 0.7071;
      output[0][i] = diff;
      output[1][i] = diff;
    }
    return true;
  }
}
registerProcessor('vocal-cancel-processor', VocalCancelProcessor);
`;

export const FORMANT_CODE = `
'use strict';
function fft(re,im,N,inv){let b=Math.log2(N)|0,j=0;for(let i=0;i<N;i++){if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}let m=N>>1;while(m>=1&&j>=m){j-=m;m>>=1}j+=m}for(let s=1;s<=b;s++){let m=1<<s,h=m>>1,wr=1,wi=0,a=Math.PI/h*(inv?1:-1),cs=Math.cos(a),sn=Math.sin(a);for(let j0=0;j0<h;j0++){for(let k=j0;k<N;k+=m){let t=k+h,tr=wr*re[t]-wi*im[t],ti=wr*im[t]+wi*re[t];re[t]=re[k]-tr;im[t]=im[k]-ti;re[k]+=tr;im[k]+=ti}let nw=wr*cs-wi*sn;wi=wr*sn+wi*cs;wr=nw}}if(inv)for(let i=0;i<N;i++){re[i]/=N;im[i]/=N}}
const FS=2048,HP=FS>>2,OB=FS*3,LQ=40,EP=1e-10;
class FormantProcessor extends AudioWorkletProcessor{
static get parameterDescriptors(){return[
{name:'enabled',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},
{name:'pitchRatio',defaultValue:1,minValue:.25,maxValue:4,automationRate:'k-rate'}]}
constructor(){super();let t=this;
t.wn=new Float32Array(FS);for(let i=0;i<FS;i++)t.wn[i]=.5*(1-Math.cos(2*Math.PI*i/(FS-1)));
t.ib=[new Float32Array(FS),new Float32Array(FS)];
t.ob=[new Float32Array(OB),new Float32Array(OB)];
t.wp=0;t.rp=0;t.ow=HP*3;t.cnt=0;
t.re=new Float32Array(FS);t.im=new Float32Array(FS);
t.r2=new Float32Array(FS);t.i2=new Float32Array(FS);
t.cr=new Float32Array(FS);t.ci=new Float32Array(FS);
t.env=new Float32Array(FS);t.tgt=new Float32Array(FS);
t.cor=new Float32Array(FS);t.mg=new Float32Array(FS);t.ph=new Float32Array(FS)}
process(ins,outs,pm){let t=this,inp=ins[0],out=outs[0];
if(!inp||!inp[0]){out.forEach(c=>c.fill(0));return true}
let en=(pm.enabled[0]??0)>=.5,pr=pm.pitchRatio[0]??1;
let N=inp[0].length,nc=Math.min(inp.length,out.length,2);
if(!en||Math.abs(pr-1)<.02){for(let c=0;c<out.length;c++)out[c].set(inp[c]||inp[0]);return true}
for(let i=0;i<N;i++){
for(let c=0;c<nc;c++)t.ib[c][t.wp]=inp[c]?inp[c][i]:inp[0][i];
t.wp=(t.wp+1)%FS;t.cnt++;
if(t.cnt>=HP){t.cnt=0;t.prc(pr,nc)}
for(let c=0;c<nc;c++){out[c][i]=t.ob[c][t.rp];t.ob[c][t.rp]=0}
t.rp=(t.rp+1)%OB}
for(let c=nc;c<out.length;c++)out[c].set(out[0]);return true}
prc(pr,nc){let t=this,re=t.re,im=t.im;
for(let i=0;i<FS;i++){let idx=(t.wp-FS+i+FS*2)%FS;re[i]=t.ib[0][idx]*t.wn[i];im[i]=0}
fft(re,im,FS,false);
let mg=t.mg,ph=t.ph;
for(let i=0;i<FS;i++){mg[i]=Math.sqrt(re[i]*re[i]+im[i]*im[i])+EP;ph[i]=Math.atan2(im[i],re[i])}
let cr=t.cr,ci=t.ci;
for(let i=0;i<FS;i++){cr[i]=Math.log(mg[i]);ci[i]=0}
fft(cr,ci,FS,true);
for(let i=LQ;i<FS-LQ;i++){cr[i]=0;ci[i]=0}
fft(cr,ci,FS,false);
let env=t.env,tgt=t.tgt,cor=t.cor;
for(let i=0;i<FS;i++)env[i]=cr[i];
for(let i=0;i<FS;i++){let si=i/pr,i0=~~si,fr=si-i0;
tgt[i]=(i0>=0&&i0+1<FS)?env[i0]*(1-fr)+env[i0+1]*fr:env[Math.min(Math.max(~~si,0),FS-1)]}
for(let i=0;i<FS;i++)cor[i]=Math.exp(tgt[i]-env[i]);
let r2=t.r2,i2=t.i2;
for(let c=0;c<nc;c++){
for(let i=0;i<FS;i++){let idx=(t.wp-FS+i+FS*2)%FS;r2[i]=t.ib[c][idx]*t.wn[i];i2[i]=0}
fft(r2,i2,FS,false);
for(let i=0;i<FS;i++){let m=Math.sqrt(r2[i]*r2[i]+i2[i]*i2[i])+EP,p=Math.atan2(i2[i],r2[i]),nm=m*cor[i];
r2[i]=nm*Math.cos(p);i2[i]=nm*Math.sin(p)}
fft(r2,i2,FS,true);
for(let i=0;i<FS;i++)t.ob[c][(t.ow+i)%OB]+=r2[i]*t.wn[i]*.667}
t.ow=(t.ow+HP)%OB}}
registerProcessor('formant-processor',FormantProcessor);
`;

export const MODULATION_CODE = `
'use strict';
const MDL=4096,MMK=MDL-1,APS=6;
class ModProcessor extends AudioWorkletProcessor{
static get parameterDescriptors(){return[
{name:'mode',defaultValue:0,minValue:0,maxValue:2,automationRate:'k-rate'},
{name:'rate',defaultValue:.5,minValue:.01,maxValue:10,automationRate:'k-rate'},
{name:'depth',defaultValue:.5,minValue:0,maxValue:1,automationRate:'k-rate'},
{name:'feedback',defaultValue:.3,minValue:-.95,maxValue:.95,automationRate:'k-rate'},
{name:'mix',defaultValue:.5,minValue:0,maxValue:1,automationRate:'k-rate'},
{name:'enabled',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'}]}
constructor(){super();let t=this;
t.dl=[new Float32Array(MDL),new Float32Array(MDL)];t.dp=0;t.lfo=0;
t.ax=[new Float32Array(APS),new Float32Array(APS)];
t.ay=[new Float32Array(APS),new Float32Array(APS)]}
process(ins,outs,pm){let t=this,inp=ins[0],out=outs[0];
if(!inp||!inp[0]){out.forEach(c=>c.fill(0));return true}
let en=(pm.enabled[0]??0)>=.5;
if(!en){for(let c=0;c<out.length;c++)out[c].set(inp[c]||inp[0]);return true}
let md=~~(pm.mode[0]??0),rt=pm.rate[0]??.5,dp=pm.depth[0]??.5;
let fb=pm.feedback[0]??.3,mx=pm.mix[0]??.5;
let N=inp[0].length,nc=Math.min(inp.length,out.length,2),sr=sampleRate,lI=rt/sr;
for(let i=0;i<N;i++){let lv=Math.sin(t.lfo*Math.PI*2);t.lfo=(t.lfo+lI)%1;
for(let c=0;c<nc;c++){let x=inp[c]?inp[c][i]:inp[0][i],wet;
if(md<2){let base=md===0?44:882,mod=md===0?dp*220:dp*662,dly=Math.max(1,base+lv*mod);
let rp=t.dp-dly;while(rp<0)rp+=MDL;let i0=~~rp,fr=rp-i0;
let y0=t.dl[c][(i0-1+MDL)&MMK],y1=t.dl[c][i0&MMK],y2=t.dl[c][(i0+1)&MMK],y3=t.dl[c][(i0+2)&MMK];
wet=(((.5*(y3-y0)+1.5*(y1-y2))*fr+(y0-2.5*y1+2*y2-.5*y3))*fr+.5*(y2-y0))*fr+y1;
t.dl[c][t.dp]=x+wet*fb}else{
let f=200+(.5+.5*lv)*3800,tn=Math.tan(Math.PI*f/sr),a=(tn-1)/(tn+1);wet=x;
for(let s=0;s<APS;s++){let xp=t.ax[c][s],yp=t.ay[c][s],yn=-a*wet+xp+a*yp;
t.ax[c][s]=wet;t.ay[c][s]=yn;wet=yn}}
out[c][i]=x*(1-mx)+wet*mx}
for(let c=nc;c<out.length;c++)out[c][i]=out[0][i];
t.dp=(t.dp+1)&MMK}return true}}
registerProcessor('mod-processor',ModProcessor);
`;

export const COMPRESSOR_CODE = `
'use strict';
class CompProcessor extends AudioWorkletProcessor{
static get parameterDescriptors(){return[
{name:'threshold',defaultValue:-10,minValue:-60,maxValue:0,automationRate:'k-rate'},
{name:'ratio',defaultValue:4,minValue:1,maxValue:20,automationRate:'k-rate'},
{name:'attack',defaultValue:10,minValue:.1,maxValue:200,automationRate:'k-rate'},
{name:'release',defaultValue:100,minValue:10,maxValue:2000,automationRate:'k-rate'},
{name:'makeup',defaultValue:0,minValue:0,maxValue:40,automationRate:'k-rate'},
{name:'enabled',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'}]}
constructor(){super();this.ev=[0,0]}
process(ins,outs,pm){let t=this,inp=ins[0],out=outs[0];
if(!inp||!inp[0]){out.forEach(c=>c.fill(0));return true}
let en=(pm.enabled[0]??0)>=.5;
if(!en){for(let c=0;c<out.length;c++)out[c].set(inp[c]||inp[0]);return true}
let thr=pm.threshold[0]??-10,rat=pm.ratio[0]??4,atk=pm.attack[0]??10,rel=pm.release[0]??100,mkup=pm.makeup[0]??0;
let sr=sampleRate,N=inp[0].length,ac=1-Math.exp(-1/(atk*.001*sr)),rc=1-Math.exp(-1/(rel*.001*sr));
let nc=Math.min(inp.length,out.length,2);
for(let i=0;i<N;i++){
for(let c=0;c<nc;c++){let x=inp[c]?inp[c][i]:inp[0][i],lvl=20*Math.log10(Math.abs(x)+1e-10);
let gr=lvl>thr?(lvl-thr)*(1-1/rat):0;
t.ev[c]+=(gr-t.ev[c])*(gr>t.ev[c]?ac:rc);
out[c][i]=x*Math.pow(10,(-t.ev[c]+mkup)/20)}
for(let c=nc;c<out.length;c++)out[c][i]=out[0][i]}return true}}
registerProcessor('comp-processor',CompProcessor);
`;
