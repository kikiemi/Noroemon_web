"use strict";
let canvas = null;
let ctx = null;
let W = 0, H = 0;
let mode = 'combined';
let hueOffset = 0;
const particles = [];
function spawnParticle(x, y, h) {
    if (particles.length >= 150)
        return;
    particles.push({ x, y, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 3 - 1, life: 1, maxLife: 1, size: Math.random() * 3 + 1, hue: h });
}
function drawBars(freq, w, h, c) {
    const n = freq.length;
    const barW = w / n;
    for (let i = 0; i < n; i++) {
        const v = freq[i] / 255;
        const bh = v * h;
        const hue = (hueOffset + i / n * 220) % 360;
        c.fillStyle = `hsl(${hue},80%,${40 + v * 30}%)`;
        c.fillRect(i * barW, h - bh, barW - 0.5, bh);
        if (v > 0.85 && Math.random() < 0.08)
            spawnParticle(i * barW + barW / 2, h - bh, hue);
    }
}
function drawCircular(freq, time, w, h, c) {
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.3;
    const n = freq.length;
    c.save();
    c.strokeStyle = `hsla(${hueOffset},70%,55%,0.35)`;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const amp = (freq[i] / 255) * r * 0.7;
        const rx = cx + Math.cos(a) * (r + amp);
        const ry = cy + Math.sin(a) * (r + amp);
        i === 0 ? c.moveTo(rx, ry) : c.lineTo(rx, ry);
    }
    c.closePath();
    c.stroke();
    c.strokeStyle = `hsla(${(hueOffset + 120) % 360},60%,60%,0.5)`;
    c.lineWidth = 1.5;
    c.beginPath();
    const tn = time.length;
    for (let i = 0; i < tn; i++) {
        const a = (i / tn) * Math.PI * 2;
        const amp = ((time[i] - 128) / 128) * r * 0.4;
        const rx = cx + Math.cos(a) * (r * 0.5 + amp);
        const ry = cy + Math.sin(a) * (r * 0.5 + amp);
        i === 0 ? c.moveTo(rx, ry) : c.lineTo(rx, ry);
    }
    c.closePath();
    c.stroke();
    c.restore();
}
function updateParticles(c) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08;
        p.life -= 0.025;
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        c.globalAlpha = p.life;
        c.fillStyle = `hsl(${p.hue},90%,70%)`;
        c.beginPath();
        c.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        c.fill();
    }
    c.globalAlpha = 1;
}
self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'init' && msg.canvas) {
        canvas = msg.canvas;
        ctx = canvas.getContext('2d', { alpha: false });
    }
    if (msg.type === 'resize' && canvas) {
        canvas.width = msg.w;
        canvas.height = msg.h;
        W = msg.w;
        H = msg.h;
    }
    if (msg.type === 'mode' && msg.mode) {
        mode = msg.mode;
    }
    if (msg.type === 'draw' && ctx && canvas && W > 0 && H > 0) {
        const freq = msg.freq;
        const time = msg.time;
        hueOffset = (hueOffset + 0.3) % 360;
        ctx.fillStyle = 'rgba(10,10,18,0.25)';
        ctx.fillRect(0, 0, W, H);
        if (mode === 'bars' || mode === 'combined')
            drawBars(freq, W, mode === 'combined' ? H / 2 : H, ctx);
        if (mode === 'circular' || mode === 'combined') {
            const offsetY = mode === 'combined' ? H / 2 : 0;
            ctx.save();
            ctx.translate(0, offsetY);
            drawCircular(freq, time, W, mode === 'combined' ? H / 2 : H, ctx);
            ctx.restore();
        }
        updateParticles(ctx);
    }
};
//# sourceMappingURL=visualizer.worker.js.map