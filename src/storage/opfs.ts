export class OPFS {
    private root: FileSystemDirectoryHandle | null = null;
    private static readonly DIR = 'tracks';

    async open(): Promise<void> {
        this.root = await navigator.storage.getDirectory();
    }

    private async dir(): Promise<FileSystemDirectoryHandle> {
        if (!this.root) throw new Error('OPFS not open');
        return this.root.getDirectoryHandle(OPFS.DIR, { create: true });
    }

    async writeFile(id: string, data: ArrayBuffer): Promise<void> {
        const d = await this.dir();
        const fh = await d.getFileHandle(id + '.bin', { create: true });
        const writable = await (fh as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
        await writable.write(data);
        await writable.close();
    }

    async readFile(id: string): Promise<ArrayBuffer | undefined> {
        try {
            const d = await this.dir();
            const fh = await d.getFileHandle(id + '.bin');
            const file = await fh.getFile();
            return file.arrayBuffer();
        } catch {
            return undefined;
        }
    }

    async deleteFile(id: string): Promise<void> {
        try {
            const d = await this.dir();
            await d.removeEntry(id + '.bin');
        } catch { }
    }

    async hasFile(id: string): Promise<boolean> {
        try {
            const d = await this.dir();
            await d.getFileHandle(id + '.bin');
            return true;
        } catch {
            return false;
        }
    }

    static isSupported(): boolean {
        return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;
    }
}
