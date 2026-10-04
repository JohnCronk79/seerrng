import fs from 'node:fs';
import path from 'node:path';

// A caller that doesn't own a directory (common when a container runs as a
// fixed non-root UID against a bind mount, NFS share, or read-only layer
// owned by the host) gets EPERM/EROFS/ENOSYS from chmod even though the
// existing permissions may already be adequate. Hardening chmod calls are
// best-effort in that case, not a reason to crash the process.
const TOLERABLE_CHMOD_ERROR_CODES = new Set(['EPERM', 'EROFS', 'ENOSYS']);

export const isTolerableChmodError = (error: unknown): boolean =>
  TOLERABLE_CHMOD_ERROR_CODES.has((error as NodeJS.ErrnoException)?.code ?? '');

export const assertNoSymlinkDirectoryComponents = (
  directory: string,
  options: { allowMissing?: boolean; label?: string } = {}
): void => {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  const components = resolved
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = root;

  for (const component of components) {
    current = path.join(current, component);

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (
        options.allowMissing &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      throw new Error(
        `${options.label ?? 'Directory path'} must not contain symlinks: ${current}`
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `${options.label ?? 'Directory path'} contains a non-directory component: ${current}`
      );
    }
  }
};
