import { AudioEngine } from './audio/engine.js';
import { AudioDB } from './storage/db.js';
import { App } from './ui/app.js';

async function main(): Promise<void> {
  const engine = new AudioEngine();
  const db = new AudioDB();
  const app = new App(engine, db);

  const el = document.getElementById('track-name');

  // iOS Safari requires a user gesture before creating AudioContext.
  // Show a tap-to-start overlay and defer engine.init() until after tap.
  const needsGesture = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

  const startApp = async () => {
    if (el) el.textContent = '起動中...';
    try {
      await app.init();
    } catch (err) {
      console.error('Failed to initialize:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (el) el.textContent = `起動失敗: ${msg}`;
      const body = document.getElementById('app');
      if (body) {
        const info = document.createElement('div');
        info.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#13141a;color:#ff6060;font-size:.9rem;padding:24px;text-align:center;z-index:9999;gap:12px;';
        info.innerHTML = `
          <div style="font-size:2rem">⚠️</div>
          <div style="font-weight:700">起動に失敗しました</div>
          <div style="color:#8890a0;font-size:.8rem;word-break:break-all">${msg}</div>
          <button onclick="location.reload()" style="margin-top:16px;padding:12px 28px;background:#f06020;border:none;color:#fff;border-radius:8px;font-size:.9rem;font-weight:700;cursor:pointer;">再試行</button>`;
        document.body.appendChild(info);
      }
    }
  };

  if (needsGesture) {
    // Show tap-to-start overlay for iOS
    const overlay = document.createElement('div');
    overlay.id = 'ios-start';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#13141a;gap:20px;cursor:pointer;';
    overlay.innerHTML = `
      <div style="font-size:3.5rem">🎵</div>
      <div style="color:#00d4ff;font-size:1.3rem;font-weight:900;letter-spacing:2px">黙々ノロえもん</div>
      <div style="color:#8890a0;font-size:.85rem">タップして起動</div>
      <div style="width:64px;height:64px;border-radius:50%;background:#f06020;display:flex;align-items:center;justify-content:center;animation:pulse 2s ease-in-out infinite;">
        <svg viewBox="0 0 24 24" width="28" height="28"><polygon points="8,5 19,12 8,19" fill="#fff"/></svg>
      </div>
      <style>@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.12);opacity:.8}}</style>`;
    document.body.appendChild(overlay);

    const go = async () => {
      overlay.remove();
      await startApp();
    };
    overlay.addEventListener('click', go, { once: true });
    overlay.addEventListener('touchend', go, { once: true, passive: true });
  } else {
    await startApp();
  }
}

document.addEventListener('DOMContentLoaded', main);
