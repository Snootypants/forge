import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface AtomicWriteOptions {
  encoding?: BufferEncoding;
  mode?: number;
}

export function atomicWriteFileSync(
  targetPath: string,
  data: string | Buffer | Uint8Array,
  options: AtomicWriteOptions = {},
): void {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const mode = options.mode ?? 0o600;
  const tempPath = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  const buffer = typeof data === 'string'
    ? Buffer.from(data, options.encoding ?? 'utf-8')
    : Buffer.from(data);

  let fd: number | null = null;
  try {
    fd = fs.openSync(tempPath, 'wx', mode);
    fs.writeFileSync(fd, buffer);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    try { fs.chmodSync(tempPath, mode); } catch { /* best effort */ }
    fs.renameSync(tempPath, targetPath);
    try { fs.chmodSync(targetPath, mode); } catch { /* best effort */ }
    fsyncDirectoryBestEffort(dir);
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    try { fs.rmSync(tempPath, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function fsyncDirectoryBestEffort(dir: string): void {
  let dirFd: number | null = null;
  try {
    dirFd = fs.openSync(dir, 'r');
    fs.fsyncSync(dirFd);
  } catch {
    /* best effort: not all platforms/filesystems allow directory fsync */
  } finally {
    if (dirFd !== null) {
      try { fs.closeSync(dirFd); } catch { /* best effort */ }
    }
  }
}
