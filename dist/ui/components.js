import { clamp } from '../types.js';
let _knobIdCounter = 0;
export class RotaryKnob {
    container;
    svg;
    arcPath;
    indicator;
    valueLabel;
    _value = 0;
    _min;
    _max;
    _step;
    _default;
    _startAngle = -135;
    _endAngle = 135;
    dragging = false;
    dragStartY = 0;
    dragStartVal = 0;
    onChange = null;
    constructor(parent, label, min, max, value, step = 0.01, unit = '', size = 58, defaultValue) {
        this._min = min;
        this._max = max;
        this._step = step;
        this._value = clamp(value, min, max);
        this._default = defaultValue ?? value;
        const gradId = `knobGrad_${++_knobIdCounter}`;
        this.container = document.createElement('div');
        this.container.className = 'knob-container';
        this.container.innerHTML = `
      <label class="knob-label">${label}</label>
      <svg class="knob-svg" width="${size}" height="${size}" viewBox="0 0 100 100"></svg>
      <input type="text" class="knob-value" readonly value="${this.formatValue(this._value, unit)}" />
    `;
        parent.appendChild(this.container);
        this.svg = this.container.querySelector('.knob-svg');
        this.valueLabel = this.container.querySelector('.knob-value');
        const trackArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        trackArc.setAttribute('d', this.describeArc(50, 50, 38, this._startAngle, this._endAngle));
        trackArc.setAttribute('fill', 'none');
        trackArc.setAttribute('stroke', 'rgba(0,0,0,0.08)');
        trackArc.setAttribute('stroke-width', '6');
        trackArc.setAttribute('stroke-linecap', 'round');
        this.svg.appendChild(trackArc);
        this.arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.arcPath.setAttribute('fill', 'none');
        this.arcPath.setAttribute('stroke', `url(#${gradId})`);
        this.arcPath.setAttribute('stroke-width', '6');
        this.arcPath.setAttribute('stroke-linecap', 'round');
        this.svg.appendChild(this.arcPath);
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `<linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f06020"/>
      <stop offset="100%" stop-color="#f06020"/>
    </linearGradient>`;
        this.svg.insertBefore(defs, this.svg.firstChild);
        const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        disc.setAttribute('cx', '50');
        disc.setAttribute('cy', '50');
        disc.setAttribute('r', '28');
        disc.setAttribute('fill', 'rgba(240,240,244,0.95)');
        disc.setAttribute('stroke', 'rgba(0,0,0,0.08)');
        disc.setAttribute('stroke-width', '1.5');
        this.svg.appendChild(disc);
        this.indicator = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        this.indicator.setAttribute('stroke', '#f06020');
        this.indicator.setAttribute('stroke-width', '3');
        this.indicator.setAttribute('stroke-linecap', 'round');
        this.svg.appendChild(this.indicator);
        this.render(unit);
        this.attachEvents(unit);
    }
    get value() { return this._value; }
    set value(v) {
        this._value = clamp(v, this._min, this._max);
        this.render();
    }
    render(unit = '') {
        const t = (this._value - this._min) / (this._max - this._min);
        const angle = this._startAngle + t * (this._endAngle - this._startAngle);
        let arcAngle;
        if (this._min < 0 && this._max > 0) {
            const zAngle = this.zeroAngle();
            if (angle < zAngle) {
                arcAngle = this.describeArc(50, 50, 38, angle, zAngle);
            }
            else {
                arcAngle = this.describeArc(50, 50, 38, zAngle, angle);
            }
        }
        else {
            arcAngle = this.describeArc(50, 50, 38, this._startAngle, angle);
        }
        this.arcPath.setAttribute('d', arcAngle);
        const rad = (angle - 90) * Math.PI / 180;
        const x1 = 50 + 14 * Math.cos(rad);
        const y1 = 50 + 14 * Math.sin(rad);
        const x2 = 50 + 26 * Math.cos(rad);
        const y2 = 50 + 26 * Math.sin(rad);
        this.indicator.setAttribute('x1', String(x1));
        this.indicator.setAttribute('y1', String(y1));
        this.indicator.setAttribute('x2', String(x2));
        this.indicator.setAttribute('y2', String(y2));
        this.valueLabel.value = this.formatValue(this._value, unit);
    }
    zeroAngle() {
        const t = (0 - this._min) / (this._max - this._min);
        return this._startAngle + t * (this._endAngle - this._startAngle);
    }
    formatValue(v, unit = '') {
        const abs = Math.abs(v);
        if (abs >= 100)
            return `${Math.round(v)}${unit}`;
        if (abs >= 10)
            return `${v.toFixed(1)}${unit}`;
        return `${v.toFixed(2)}${unit}`;
    }
    attachEvents(unit) {
        const onDown = (e) => {
            if (e.target.tagName === 'INPUT')
                return;
            e.preventDefault();
            this.dragging = true;
            this.dragStartY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            this.dragStartVal = this._value;
            this.container.classList.add('active');
        };
        const onMove = (e) => {
            if (!this.dragging)
                return;
            const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
            const delta = (this.dragStartY - y) * (this._max - this._min) / 200;
            const raw = this.dragStartVal + delta;
            const stepped = Math.round(raw / this._step) * this._step;
            const newVal = clamp(stepped, this._min, this._max);
            if (newVal !== this._value) {
                this._value = newVal;
                this.render(unit);
                this.onChange?.(this._value);
            }
        };
        const onUp = () => {
            this.dragging = false;
            this.container.classList.remove('active');
        };
        this.svg.addEventListener('mousedown', onDown);
        this.svg.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
        this.svg.addEventListener('dblclick', () => {
            this._value = clamp(this._default, this._min, this._max);
            this.render(unit);
            this.onChange?.(this._value);
        });
        this.valueLabel.addEventListener('focus', () => {
            this.valueLabel.removeAttribute('readonly');
            this.valueLabel.select();
        });
        const applyInput = () => {
            this.valueLabel.setAttribute('readonly', '');
            const parsed = parseFloat(this.valueLabel.value);
            if (!isNaN(parsed)) {
                this._value = clamp(Math.round(parsed / this._step) * this._step, this._min, this._max);
                this.render(unit);
                this.onChange?.(this._value);
            }
            else {
                this.valueLabel.value = this.formatValue(this._value, unit);
            }
        };
        this.valueLabel.addEventListener('blur', applyInput);
        this.valueLabel.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.valueLabel.blur();
            }
            if (e.key === 'Escape') {
                this.valueLabel.setAttribute('readonly', '');
                this.valueLabel.value = this.formatValue(this._value, unit);
                this.valueLabel.blur();
            }
        });
        this.valueLabel.addEventListener('dblclick', () => {
            this._value = clamp(this._default, this._min, this._max);
            this.render(unit);
            this.onChange?.(this._value);
        });
    }
    describeArc(cx, cy, r, startAngle, endAngle) {
        const s = this.polarToCartesian(cx, cy, r, endAngle);
        const e = this.polarToCartesian(cx, cy, r, startAngle);
        const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
        return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 0 ${e.x} ${e.y}`;
    }
    polarToCartesian(cx, cy, r, angleDeg) {
        const rad = (angleDeg - 90) * Math.PI / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    }
}
export class SmoothSlider {
    container;
    track;
    fill;
    thumb;
    valueLabel;
    _value;
    _min;
    _max;
    _step;
    _default;
    dragging = false;
    onChange = null;
    constructor(parent, label, min, max, value, step = 0.01, unit = '', defaultValue) {
        this._min = min;
        this._max = max;
        this._step = step;
        this._value = clamp(value, min, max);
        this._default = defaultValue ?? value;
        this.container = document.createElement('div');
        this.container.className = 'slider-container';
        this.container.innerHTML = `
      <label class="slider-label">${label}</label>
      <div class="slider-track-wrap">
        <div class="slider-track">
          <div class="slider-fill"></div>
          <div class="slider-thumb"></div>
        </div>
      </div>
      <input type="text" class="slider-value" readonly value="" />
    `;
        parent.appendChild(this.container);
        this.track = this.container.querySelector('.slider-track');
        this.fill = this.container.querySelector('.slider-fill');
        this.thumb = this.container.querySelector('.slider-thumb');
        this.valueLabel = this.container.querySelector('.slider-value');
        this.render(unit);
        this.attachEvents(unit);
    }
    get value() { return this._value; }
    set value(v) {
        this._value = clamp(v, this._min, this._max);
        this.render();
    }
    formatValue(v, unit = '') {
        const abs = Math.abs(v);
        if (abs >= 100)
            return `${Math.round(v)}${unit}`;
        if (abs >= 10)
            return `${v.toFixed(1)}${unit}`;
        return `${v.toFixed(2)}${unit}`;
    }
    render(unit = '') {
        const t = (this._value - this._min) / (this._max - this._min);
        this.fill.style.width = `${t * 100}%`;
        this.thumb.style.left = `${t * 100}%`;
        this.valueLabel.value = this.formatValue(this._value, unit);
    }
    attachEvents(unit) {
        const getVal = (clientX) => {
            const rect = this.track.getBoundingClientRect();
            const t = clamp((clientX - rect.left) / rect.width, 0, 1);
            const raw = this._min + t * (this._max - this._min);
            return Math.round(raw / this._step) * this._step;
        };
        const onDown = (e) => {
            if (e.target.tagName === 'INPUT')
                return;
            e.preventDefault();
            this.dragging = true;
            const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
            this._value = clamp(getVal(x), this._min, this._max);
            this.render(unit);
            this.onChange?.(this._value);
        };
        const onMove = (e) => {
            if (!this.dragging)
                return;
            const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
            this._value = clamp(getVal(x), this._min, this._max);
            this.render(unit);
            this.onChange?.(this._value);
        };
        const onUp = () => { this.dragging = false; };
        this.track.addEventListener('mousedown', onDown);
        this.track.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
        this.track.addEventListener('dblclick', () => {
            this._value = clamp(this._default, this._min, this._max);
            this.render(unit);
            this.onChange?.(this._value);
        });
        this.valueLabel.addEventListener('focus', () => {
            this.valueLabel.removeAttribute('readonly');
            this.valueLabel.select();
        });
        const applyInput = () => {
            this.valueLabel.setAttribute('readonly', '');
            const parsed = parseFloat(this.valueLabel.value);
            if (!isNaN(parsed)) {
                this._value = clamp(Math.round(parsed / this._step) * this._step, this._min, this._max);
                this.render(unit);
                this.onChange?.(this._value);
            }
            else {
                this.valueLabel.value = this.formatValue(this._value, unit);
            }
        };
        this.valueLabel.addEventListener('blur', applyInput);
        this.valueLabel.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.valueLabel.blur();
            }
            if (e.key === 'Escape') {
                this.valueLabel.setAttribute('readonly', '');
                this.valueLabel.value = this.formatValue(this._value, unit);
                this.valueLabel.blur();
            }
        });
        this.valueLabel.addEventListener('dblclick', () => {
            this._value = clamp(this._default, this._min, this._max);
            this.render(unit);
            this.onChange?.(this._value);
        });
    }
}
export class WaveformDisplay {
    canvas;
    ctx;
    peaks = new Float32Array(0);
    negPeaks = new Float32Array(0);
    _position = 0;
    _duration = 0;
    _loopStart = -1;
    _loopEnd = -1;
    _abSelecting = false;
    _abStartX = 0;
    _peakWorker = null;
    onClick = null;
    onLoopSelect = null;
    constructor(parent) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'waveform-canvas';
        this.canvas.height = 100;
        parent.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        const resizeObserver = new ResizeObserver(() => {
            this.canvas.width = this.canvas.clientWidth * (window.devicePixelRatio || 1);
            this.canvas.height = this.canvas.clientHeight * (window.devicePixelRatio || 1);
            this.draw();
        });
        resizeObserver.observe(this.canvas);
        this.attachEvents();
    }
    setAudioBuffer(buffer) {
        this._duration = buffer.duration;
        this.peaks = new Float32Array(0);
        this.negPeaks = new Float32Array(0);
        this.draw();
        if (this._peakWorker) {
            this._peakWorker.terminate();
            this._peakWorker = null;
        }
        const src = `
      self.onmessage = function(e) {
        var data = e.data, buckets = 1024;
        var per = Math.floor(data.length / buckets);
        var peaks = new Float32Array(buckets);
        var neg   = new Float32Array(buckets);
        for (var i = 0; i < buckets; i++) {
          var mx = 0, mn = 0, st = i * per;
          for (var j = 0; j < per; j++) {
            var v = data[st + j];
            if (v > mx) mx = v;
            if (v < mn) mn = v;
          }
          peaks[i] = mx; neg[i] = mn;
        }
        self.postMessage({ peaks: peaks, neg: neg }, [peaks.buffer, neg.buffer]);
      };
    `;
        const blob = new Blob([src], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url);
        this._peakWorker = w;
        const copy = buffer.getChannelData(0).slice();
        w.postMessage(copy, [copy.buffer]);
        w.onmessage = (e) => {
            this.peaks = e.data.peaks;
            this.negPeaks = e.data.neg;
            this.draw();
            w.terminate();
            URL.revokeObjectURL(url);
            if (this._peakWorker === w)
                this._peakWorker = null;
        };
    }
    setPosition(t) {
        this._position = t;
        this.draw();
    }
    setLoop(start, end) {
        this._loopStart = start;
        this._loopEnd = end;
        this.draw();
    }
    clearLoop() {
        this._loopStart = -1;
        this._loopEnd = -1;
        this.draw();
    }
    draw() {
        const c = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;
        if (W <= 0 || H <= 0)
            return;
        const dpr = window.devicePixelRatio || 1;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = W / dpr;
        const h = H / dpr;
        c.clearRect(0, 0, w, h);
        if (this.peaks.length === 0)
            return;
        if (this._loopStart >= 0 && this._loopEnd > this._loopStart && this._duration > 0) {
            const lx = (this._loopStart / this._duration) * w;
            const rx = (this._loopEnd / this._duration) * w;
            c.fillStyle = 'rgba(240, 96, 32, 0.08)';
            c.fillRect(lx, 0, rx - lx, h);
            c.strokeStyle = 'rgba(240, 96, 32, 0.5)';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(lx, 0);
            c.lineTo(lx, h);
            c.moveTo(rx, 0);
            c.lineTo(rx, h);
            c.stroke();
        }
        const mid = h / 2;
        const bw = w / this.peaks.length;
        const grad = c.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#f06020');
        grad.addColorStop(0.5, '#d04818');
        grad.addColorStop(1, '#f06020');
        c.fillStyle = grad;
        c.globalAlpha = 0.7;
        c.beginPath();
        for (let i = 0; i < this.peaks.length; i++) {
            const x = i * bw;
            const pH = this.peaks[i] * mid * 0.9;
            const nH = -this.negPeaks[i] * mid * 0.9;
            c.rect(x, mid - pH, Math.max(bw - 0.5, 0.5), pH + nH);
        }
        c.fill();
        c.globalAlpha = 1;
        const px = this._position * w;
        c.strokeStyle = '#1a1a1a';
        c.lineWidth = 2;
        c.shadowColor = '#f06020';
        c.shadowBlur = 8;
        c.beginPath();
        c.moveTo(px, 0);
        c.lineTo(px, h);
        c.stroke();
        c.shadowBlur = 0;
    }
    attachEvents() {
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.shiftKey) {
                this._abSelecting = true;
                this._abStartX = e.offsetX;
            }
            else {
                const t = e.offsetX / this.canvas.clientWidth;
                this.onClick?.(t);
            }
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (this._abSelecting && this._duration > 0) {
                const w = this.canvas.clientWidth;
                const s = Math.min(this._abStartX, e.offsetX) / w * this._duration;
                const en = Math.max(this._abStartX, e.offsetX) / w * this._duration;
                this._loopStart = s;
                this._loopEnd = en;
                this.draw();
            }
        });
        this.canvas.addEventListener('mouseup', () => {
            if (this._abSelecting && this._loopEnd > this._loopStart) {
                this.onLoopSelect?.(this._loopStart, this._loopEnd);
            }
            this._abSelecting = false;
        });
    }
}
export class EQSliderBank {
    container;
    sliders = [];
    onChange = null;
    constructor(parent, labels, initialGains) {
        this.container = document.createElement('div');
        this.container.className = 'eq-bank';
        parent.appendChild(this.container);
        labels.forEach((freq, i) => {
            const col = document.createElement('div');
            col.className = 'eq-col';
            const bar = document.createElement('div');
            bar.className = 'eq-bar';
            const fill = document.createElement('div');
            fill.className = 'eq-fill';
            bar.appendChild(fill);
            const lbl = document.createElement('span');
            lbl.className = 'eq-freq';
            lbl.textContent = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
            col.appendChild(bar);
            col.appendChild(lbl);
            this.container.appendChild(col);
            const entry = { el: bar, fill, value: initialGains[i] ?? 0 };
            this.sliders.push(entry);
            this.renderOne(i);
            let dragging = false;
            const getVal = (clientY) => {
                const rect = bar.getBoundingClientRect();
                const t = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
                return (t * 24) - 12;
            };
            bar.addEventListener('mousedown', (e) => {
                dragging = true;
                entry.value = getVal(e.clientY);
                this.renderOne(i);
                this.onChange?.(i, entry.value);
            });
            window.addEventListener('mousemove', (e) => {
                if (!dragging)
                    return;
                entry.value = getVal(e.clientY);
                this.renderOne(i);
                this.onChange?.(i, entry.value);
            });
            window.addEventListener('mouseup', () => { dragging = false; });
        });
    }
    setGains(gains) {
        gains.forEach((g, i) => {
            if (this.sliders[i]) {
                this.sliders[i].value = g;
                this.renderOne(i);
            }
        });
    }
    renderOne(i) {
        const entry = this.sliders[i];
        const t = (entry.value + 12) / 24;
        entry.fill.style.height = `${t * 100}%`;
        entry.fill.style.bottom = '0';
    }
}
//# sourceMappingURL=components.js.map