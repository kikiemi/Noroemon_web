import { AudioEngine } from './audio/engine.js';
import { AudioDB } from './storage/db.js';
import { App } from './ui/app.js';
async function main() {
    const engine = new AudioEngine();
    const db = new AudioDB();
    const app = new App(engine, db);
    try {
        await app.init();
        console.log('黙々ノロえもん (Noroemon) initialized successfully');
    }
    catch (err) {
        console.error('Failed to initialize:', err);
        const el = document.getElementById('track-name');
        if (el)
            el.textContent = '初期化に失敗しました — コンソールを確認してください';
    }
}
document.addEventListener('DOMContentLoaded', main);
//# sourceMappingURL=main.js.map