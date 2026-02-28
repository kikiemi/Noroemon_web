import { generateId } from '../types.js';
import { OPFS } from './opfs.js';
const DB_NAME = 'WaveForgeDB';
const DB_VERSION = 2;
const STORE_TRACKS = 'tracks';
const STORE_AUDIO = 'audio';
const STORE_PLAYLISTS = 'playlists';
export class AudioDB {
    db = null;
    opfs = new OPFS();
    useOpfs = OPFS.isSupported();
    async open() {
        if (this.useOpfs)
            await this.opfs.open();
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_TRACKS))
                    db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(STORE_AUDIO))
                    db.createObjectStore(STORE_AUDIO);
                if (!db.objectStoreNames.contains(STORE_PLAYLISTS))
                    db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
            };
            req.onsuccess = () => { this.db = req.result; resolve(); };
            req.onerror = () => reject(req.error);
        });
    }
    hasLegacyAudio() {
        return new Promise(resolve => {
            if (!this.db) {
                resolve(false);
                return;
            }
            const req = this.db.transaction(STORE_AUDIO, 'readonly').objectStore(STORE_AUDIO).count();
            req.onsuccess = () => resolve(req.result > 0);
            req.onerror = () => resolve(false);
        });
    }
    async addTrack(file, audioData, meta = {}) {
        const id = generateId();
        const trackMeta = {
            id,
            name: meta.name ?? file.name.replace(/\.[^.]+$/, ''),
            duration: meta.duration ?? 0,
            sampleRate: meta.sampleRate ?? 44100,
            channels: meta.channels ?? 2,
            addedAt: Date.now(),
            size: audioData.byteLength,
        };
        await this.put(STORE_TRACKS, trackMeta);
        if (this.useOpfs) {
            await this.opfs.writeFile(id, audioData);
        }
        else {
            await this.putRaw(STORE_AUDIO, id, audioData);
        }
        return trackMeta;
    }
    async getTrackMeta(id) {
        return this.get(STORE_TRACKS, id);
    }
    async getAudioData(id) {
        if (this.useOpfs) {
            const data = await this.opfs.readFile(id);
            if (data)
                return data;
        }
        return this.getRaw(STORE_AUDIO, id);
    }
    async getAllTrackMetas() {
        return this.getAll(STORE_TRACKS);
    }
    async deleteTrack(id) {
        await this.del(STORE_TRACKS, id);
        if (this.useOpfs) {
            await this.opfs.deleteFile(id);
        }
        else {
            await this.del(STORE_AUDIO, id);
        }
    }
    async deleteTrackCascade(id) {
        await this.deleteTrack(id);
        const playlists = await this.getAllPlaylists();
        for (const pl of playlists) {
            if (pl.trackIds.includes(id)) {
                pl.trackIds = pl.trackIds.filter(tid => tid !== id);
                await this.updatePlaylist(pl);
            }
        }
    }
    async updateTrackMeta(meta) {
        await this.put(STORE_TRACKS, meta);
    }
    async addPlaylist(name) {
        const pl = { id: generateId(), name, trackIds: [], createdAt: Date.now() };
        await this.put(STORE_PLAYLISTS, pl);
        return pl;
    }
    async getPlaylist(id) {
        return this.get(STORE_PLAYLISTS, id);
    }
    async getAllPlaylists() {
        return this.getAll(STORE_PLAYLISTS);
    }
    async updatePlaylist(pl) {
        await this.put(STORE_PLAYLISTS, pl);
    }
    async deletePlaylist(id) {
        await this.del(STORE_PLAYLISTS, id);
    }
    tx(store, mode = 'readonly') {
        if (!this.db)
            throw new Error('Database not open');
        return this.db.transaction(store, mode).objectStore(store);
    }
    put(store, value) {
        return new Promise((resolve, reject) => {
            const req = this.tx(store, 'readwrite').put(value);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
    putRaw(store, key, value) {
        return new Promise((resolve, reject) => {
            const req = this.tx(store, 'readwrite').put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
    get(store, key) {
        return new Promise((resolve, reject) => {
            const req = this.tx(store).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    getRaw(store, key) {
        return new Promise((resolve, reject) => {
            const req = this.tx(store).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    getAll(store) {
        return new Promise((resolve, reject) => {
            const req = this.tx(store).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    del(store, key) {
        return new Promise((resolve, reject) => {
            const req = this.tx(store, 'readwrite').delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}
//# sourceMappingURL=db.js.map