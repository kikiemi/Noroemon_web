import { PlayMode } from '../types.js';
export class PlaylistManager {
    db;
    playlists = new Map();
    currentPlaylistId = null;
    currentIndex = 0;
    shuffleOrder = [];
    shuffleIndex = 0;
    playMode = PlayMode.Sequential;
    constructor(db) {
        this.db = db;
    }
    async loadFromDB() {
        const lists = await this.db.getAllPlaylists();
        this.playlists.clear();
        for (const pl of lists) {
            this.playlists.set(pl.id, pl);
        }
        if (this.playlists.size === 0) {
            await this.createPlaylist('デフォルト');
        }
    }
    async saveToDB(id) {
        const pl = this.playlists.get(id);
        if (pl)
            await this.db.updatePlaylist(pl);
    }
    async createPlaylist(name) {
        const pl = await this.db.addPlaylist(name);
        this.playlists.set(pl.id, pl);
        if (!this.currentPlaylistId)
            this.currentPlaylistId = pl.id;
        return pl;
    }
    async deletePlaylist(id) {
        this.playlists.delete(id);
        await this.db.deletePlaylist(id);
        if (this.currentPlaylistId === id) {
            const first = this.playlists.keys().next().value;
            this.currentPlaylistId = first ?? null;
            this.currentIndex = 0;
        }
    }
    getAll() {
        return [...this.playlists.values()];
    }
    getCurrent() {
        return this.currentPlaylistId ? this.playlists.get(this.currentPlaylistId) ?? null : null;
    }
    setCurrentPlaylist(id) {
        if (this.playlists.has(id)) {
            this.currentPlaylistId = id;
            this.currentIndex = 0;
            this.reshufle();
        }
    }
    async addTrack(playlistId, trackId) {
        const pl = this.playlists.get(playlistId);
        if (!pl)
            return;
        if (!pl.trackIds.includes(trackId)) {
            pl.trackIds.push(trackId);
            await this.saveToDB(playlistId);
            this.reshufle();
        }
    }
    async removeTrack(playlistId, trackId) {
        const pl = this.playlists.get(playlistId);
        if (!pl)
            return;
        pl.trackIds = pl.trackIds.filter(t => t !== trackId);
        await this.saveToDB(playlistId);
        if (this.currentIndex >= pl.trackIds.length) {
            this.currentIndex = Math.max(0, pl.trackIds.length - 1);
        }
        this.reshufle();
    }
    getCurrentTrackId() {
        const pl = this.getCurrent();
        if (!pl || pl.trackIds.length === 0)
            return null;
        if (this.playMode === PlayMode.Shuffle) {
            return pl.trackIds[this.shuffleOrder[this.shuffleIndex] ?? 0] ?? null;
        }
        return pl.trackIds[this.currentIndex] ?? null;
    }
    setCurrentIndex(index) {
        this.currentIndex = index;
    }
    setCurrentTrack(trackId) {
        const pl = this.getCurrent();
        if (!pl)
            return;
        const idx = pl.trackIds.indexOf(trackId);
        if (idx >= 0)
            this.currentIndex = idx;
    }
    getNextTrackId() {
        const pl = this.getCurrent();
        if (!pl || pl.trackIds.length === 0)
            return null;
        switch (this.playMode) {
            case PlayMode.Sequential: {
                this.currentIndex++;
                if (this.currentIndex >= pl.trackIds.length)
                    return null;
                return pl.trackIds[this.currentIndex];
            }
            case PlayMode.RepeatAll: {
                this.currentIndex = (this.currentIndex + 1) % pl.trackIds.length;
                return pl.trackIds[this.currentIndex];
            }
            case PlayMode.RepeatOne: {
                return pl.trackIds[this.currentIndex];
            }
            case PlayMode.Shuffle: {
                this.shuffleIndex++;
                if (this.shuffleIndex >= this.shuffleOrder.length) {
                    this.reshufle();
                    this.shuffleIndex = 0;
                }
                this.currentIndex = this.shuffleOrder[this.shuffleIndex];
                return pl.trackIds[this.currentIndex];
            }
        }
    }
    getPrevTrackId() {
        const pl = this.getCurrent();
        if (!pl || pl.trackIds.length === 0)
            return null;
        if (this.playMode === PlayMode.Shuffle) {
            this.shuffleIndex = Math.max(0, this.shuffleIndex - 1);
            this.currentIndex = this.shuffleOrder[this.shuffleIndex];
            return pl.trackIds[this.currentIndex];
        }
        this.currentIndex = Math.max(0, this.currentIndex - 1);
        return pl.trackIds[this.currentIndex];
    }
    reshufle() {
        const pl = this.getCurrent();
        if (!pl)
            return;
        this.shuffleOrder = pl.trackIds.map((_, i) => i);
        for (let i = this.shuffleOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.shuffleOrder[i], this.shuffleOrder[j]] = [this.shuffleOrder[j], this.shuffleOrder[i]];
        }
        this.shuffleIndex = 0;
    }
}
//# sourceMappingURL=manager.js.map