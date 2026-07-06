import { gzipSync } from 'node:zlib';

/**
 * Minimal deterministic ustar writer -- just enough to build the npm-style tarballs the
 * marketplace registry serves (bundle.ts). Dependency-free on purpose (MISSION-CONTEXT §7).
 * Regular files only, relative POSIX names, mtime pinned by the caller for reproducibility.
 */

const BLOCK = 512;

export interface TarEntry {
  /** Relative POSIX path inside the archive (e.g. `package/skills/foo/SKILL.md`). */
  name: string;
  content: string | Uint8Array;
}

function octal(value: number, width: number): Buffer {
  const s = value.toString(8).padStart(width - 1, '0');
  return Buffer.from(`${s}\0`, 'ascii');
}

function header(name: string, size: number, mtimeSec: number): Buffer {
  const buf = Buffer.alloc(BLOCK, 0);
  let namePart = name;
  let prefixPart = '';
  if (Buffer.byteLength(name, 'utf8') > 100) {
    // ustar prefix split: prefix(155) + "/" + name(100).
    const slash = name.slice(0, 155).lastIndexOf('/');
    if (slash <= 0 || Buffer.byteLength(name.slice(slash + 1), 'utf8') > 100) {
      throw new Error(`tar entry name too long: ${name}`);
    }
    prefixPart = name.slice(0, slash);
    namePart = name.slice(slash + 1);
  }
  buf.write(namePart, 0, 100, 'utf8');
  octal(0o644, 8).copy(buf, 100); // mode
  octal(0, 8).copy(buf, 108); // uid
  octal(0, 8).copy(buf, 116); // gid
  octal(size, 12).copy(buf, 124);
  octal(mtimeSec, 12).copy(buf, 136);
  buf.fill(0x20, 148, 156); // chksum placeholder = spaces
  buf.write('0', 156, 1, 'ascii'); // typeflag: regular file
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  buf.write(prefixPart, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of buf) sum += byte;
  const chk = sum.toString(8).padStart(6, '0');
  buf.write(`${chk}\0 `, 148, 8, 'ascii');
  return buf;
}

export function buildTar(entries: TarEntry[], mtimeSec: number): Buffer {
  const parts: Buffer[] = [];
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const body =
      typeof entry.content === 'string'
        ? Buffer.from(entry.content, 'utf8')
        : Buffer.from(entry.content);
    parts.push(header(entry.name, body.length, mtimeSec));
    parts.push(body);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0)); // end-of-archive
  return Buffer.concat(parts);
}

/** Deterministic .tgz (gzip mtime pinned to 0 by gzipSync; tar mtime pinned by caller). */
export function buildTgz(entries: TarEntry[], mtimeSec: number): Buffer {
  return gzipSync(buildTar(entries, mtimeSec), { level: 9 });
}

/** Tiny reader used by tests/acceptance to prove round-trip fidelity (not a general parser). */
export function readTar(tar: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every((b) => b === 0)) break;
    const rawName = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(block.subarray(124, 136).toString('ascii').replace(/\0.*$/, ''), 8);
    const name = prefix ? `${prefix}/${rawName}` : rawName;
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    entries.push({ name, content: Buffer.from(body).toString('utf8') });
    offset += BLOCK + size + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
  return entries;
}
