import { access, readFile } from 'fs/promises';
import { dirname, isAbsolute, join, relative } from 'path';

/** Simpan path relatif terhadap upload root agar aman pindah server / cwd. */
export function toRelativeUploadPath(
  uploadRoot: string,
  absolutePath: string,
): string {
  const root = uploadRoot.endsWith('/') ? uploadRoot.slice(0, -1) : uploadRoot;
  if (absolutePath.startsWith(root + '/') || absolutePath === root) {
    return relative(root, absolutePath);
  }
  if (!isAbsolute(absolutePath)) {
    return absolutePath;
  }
  return absolutePath;
}

export function resolveUploadPath(uploadRoot: string, stored: string): string {
  if (isAbsolute(stored)) {
    return stored;
  }
  return join(uploadRoot, stored);
}

/** Coba beberapa path (legacy absolut, ekstensi lama). */
export async function readFirstExistingFile(
  candidates: string[],
): Promise<{ path: string; data: Buffer } | null> {
  const seen = new Set<string>();
  for (const p of candidates) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    try {
      await access(p);
      const data = await readFile(p);
      return { path: p, data };
    } catch {
      /* ENOENT */
    }
  }
  return null;
}

function legacyRelativeUnderUploads(stored: string): string | null {
  const marker = '/uploads/';
  const idx = stored.indexOf(marker);
  if (idx >= 0) return stored.slice(idx + marker.length);
  const emp = stored.indexOf('employees/');
  if (emp >= 0) return stored.slice(emp);
  return null;
}

/** Varian ekstensi setelah kompresi WebP (photo.jpg → photo.webp). */
export function photoPathFallbackCandidates(
  uploadRoot: string,
  stored: string,
): string[] {
  const primary = resolveUploadPath(uploadRoot, stored);
  const list = [primary];
  const legacyRel = legacyRelativeUnderUploads(stored);
  if (legacyRel) {
    list.push(resolveUploadPath(uploadRoot, legacyRel));
    list.push(
      resolveUploadPath(
        uploadRoot,
        legacyRel.replace(/\.jpe?g$/i, '.webp'),
      ),
    );
    list.push(
      resolveUploadPath(uploadRoot, join(dirname(legacyRel), 'photo.webp')),
    );
  }
  if (/\.jpe?g$/i.test(stored) || /\.jpe?g$/i.test(primary)) {
    list.push(primary.replace(/\.jpe?g$/i, '.webp'));
    list.push(join(dirname(primary), 'photo.webp'));
  }
  if (!isAbsolute(stored)) {
    const relWebp = stored.replace(/\.jpe?g$/i, '.webp');
    if (relWebp !== stored) {
      list.push(resolveUploadPath(uploadRoot, relWebp));
    }
    list.push(resolveUploadPath(uploadRoot, join(dirname(stored), 'photo.webp')));
  }
  return list;
}
