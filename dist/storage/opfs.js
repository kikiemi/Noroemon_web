export class OPFS {
    root = null;
    static DIR = 'tracks';
    async open() {
        this.root = await navigator.storage.getDirectory();
    }
    async dir() {
        if (!this.root)
            throw new Error('OPFS not open');
        return this.root.getDirectoryHandle(OPFS.DIR, { create: true });
    }
    async writeFile(id, data) {
        const d = await this.dir();
        const fh = await d.getFileHandle(id + '.bin', { create: true });
        const writable = await fh.createWritable();
        await writable.write(data);
        await writable.close();
    }
    async readFile(id) {
        try {
            const d = await this.dir();
            const fh = await d.getFileHandle(id + '.bin');
            const file = await fh.getFile();
            return file.arrayBuffer();
        }
        catch {
            return undefined;
        }
    }
    async deleteFile(id) {
        try {
            const d = await this.dir();
            await d.removeEntry(id + '.bin');
        }
        catch { }
    }
    async hasFile(id) {
        try {
            const d = await this.dir();
            await d.getFileHandle(id + '.bin');
            return true;
        }
        catch {
            return false;
        }
    }
    static isSupported() {
        return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;
    }
}
//# sourceMappingURL=opfs.js.map