import { TrackMeta, PlaylistData, generateId } from '../types.js';
import { OPFS } from './opfs.js';

const DB_NAME = 'WaveForgeDB';
const DB_VERSION = 2;
const STORE_TRACKS = 'tracks';
const STORE_AUDIO = 'audio';
const STORE_PLAYLISTS = 'playlists';

export class AudioDB {
  private db: IDBDatabase | null = null;
  private opfs = new OPFS();
  private useOpfs = OPFS.isSupported();

  async open(): Promise<void> {
    if (this.useOpfs) await this.opfs.open();
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_TRACKS)) db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_AUDIO)) db.createObjectStore(STORE_AUDIO);
        if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  hasLegacyAudio(): Promise<boolean> {
    return new Promise(resolve => {
      if (!this.db) { resolve(false); return; }
      const req = this.db.transaction(STORE_AUDIO, 'readonly').objectStore(STORE_AUDIO).count();
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => resolve(false);
    });
  }

  async addTrack(file: File, audioData: ArrayBuffer, meta: Partial<TrackMeta> = {}): Promise<TrackMeta> {
    const id = generateId();
    const trackMeta: TrackMeta = {
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
    } else {
      await this.putRaw(STORE_AUDIO, id, audioData);
    }
    return trackMeta;
  }

  async getTrackMeta(id: string): Promise<TrackMeta | undefined> {
    return this.get<TrackMeta>(STORE_TRACKS, id);
  }

  async getAudioData(id: string): Promise<ArrayBuffer | undefined> {
    if (this.useOpfs) {
      const data = await this.opfs.readFile(id);
      if (data) return data;
    }
    return this.getRaw<ArrayBuffer>(STORE_AUDIO, id);
  }

  async getAllTrackMetas(): Promise<TrackMeta[]> {
    return this.getAll<TrackMeta>(STORE_TRACKS);
  }

  async deleteTrack(id: string): Promise<void> {
    await this.del(STORE_TRACKS, id);
    if (this.useOpfs) {
      await this.opfs.deleteFile(id);
    } else {
      await this.del(STORE_AUDIO, id);
    }
  }

  async deleteTrackCascade(id: string): Promise<void> {
    await this.deleteTrack(id);
    const playlists = await this.getAllPlaylists();
    for (const pl of playlists) {
      if (pl.trackIds.includes(id)) {
        pl.trackIds = pl.trackIds.filter(tid => tid !== id);
        await this.updatePlaylist(pl);
      }
    }
  }

  async updateTrackMeta(meta: TrackMeta): Promise<void> {
    await this.put(STORE_TRACKS, meta);
  }

  async addPlaylist(name: string): Promise<PlaylistData> {
    const pl: PlaylistData = { id: generateId(), name, trackIds: [], createdAt: Date.now() };
    await this.put(STORE_PLAYLISTS, pl);
    return pl;
  }

  async getPlaylist(id: string): Promise<PlaylistData | undefined> {
    return this.get<PlaylistData>(STORE_PLAYLISTS, id);
  }

  async getAllPlaylists(): Promise<PlaylistData[]> {
    return this.getAll<PlaylistData>(STORE_PLAYLISTS);
  }

  async updatePlaylist(pl: PlaylistData): Promise<void> {
    await this.put(STORE_PLAYLISTS, pl);
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.del(STORE_PLAYLISTS, id);
  }

  private tx(store: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    if (!this.db) throw new Error('Database not open');
    return this.db.transaction(store, mode).objectStore(store);
  }

  private put(store: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx(store, 'readwrite').put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private putRaw(store: string, key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx(store, 'readwrite').put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private get<T>(store: string, key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const req = this.tx(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private getRaw<T>(store: string, key: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const req = this.tx(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private getAll<T>(store: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const req = this.tx(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  }

  private del(store: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = this.tx(store, 'readwrite').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
