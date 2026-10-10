import { MemoryFileSystem, AggregatedFileSystem } from './fileSystem';

describe('MemoryFileSystem', () => {
    it('should resolve . and .. segments when normalizing', () => {
        const fs = new MemoryFileSystem();
        expect(fs.normalize('/a/b/../c/./d.ccs')).toBe('/a/c/d.ccs');
        expect(fs.normalize('/a/../../b')).toBe('/b');
        expect(fs.normalize('/a/b/')).toBe('/a/b');
        expect(fs.join('/project/src', '../lib/utils.ccs')).toBe('/project/lib/utils.ccs');
    });

    it('should list only files directly inside a directory', async () => {
        const fs = new MemoryFileSystem();
        fs.addFile('/p/a.ccs', '');
        fs.addFile('/p/b.txt', '');
        fs.addFile('/p/sub/c.ccs', '');

        expect((await fs.readDirectory('/p')).sort()).toEqual(['/p/a.ccs', '/p/b.txt']);
        expect(await fs.readDirectory('/missing')).toEqual([]);
    });
});

describe('AggregatedFileSystem', () => {
    it('should merge directory listings without duplicates', async () => {
        const primary = new MemoryFileSystem();
        const fallback = new MemoryFileSystem();
        primary.addFile('/p/open.ccs', '');
        primary.addFile('/p/both.ccs', '');
        fallback.addFile('/p/both.ccs', '');
        fallback.addFile('/p/disk.ccs', '');

        const fs = new AggregatedFileSystem(primary, fallback);
        expect((await fs.readDirectory('/p')).sort()).toEqual(['/p/both.ccs', '/p/disk.ccs', '/p/open.ccs']);
    });
});
