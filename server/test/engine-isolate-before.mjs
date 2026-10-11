import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// Must execute BEFORE the original setup imports datasource/settings. Vitest
// isolates JS modules, but inherited runtime modes and environment paths
// otherwise survive worker reuse and can change unit-test behavior.
const prefix = 'seerrng-engine-config-';
const directory = mkdtempSync(join(tmpdir(), prefix));
const inheritedRuntimeKeys = new Set([
  'E2E_TESTS',
  'SEERR_EXTERNAL_CONFIG',
  'SEERR_EXTERNAL_READ_ONLY',
]);
for (const key of Object.keys(process.env)) {
  if (/^(?:DB_|DATABASE_)/.test(key) || inheritedRuntimeKeys.has(key))
    delete process.env[key];
}
process.env.NODE_ENV = 'test';
process.env.CONFIG_DIRECTORY = directory;
process.env.ALLOW_NETWORK = 'false';
process.env.SEERR_TEST_FAIL_ON_NETWORK = 'true';

// A single worker-exit hook keeps config alive until all teardown hooks and
// owned subprocesses finish. Never recursively remove an inherited directory.
const owner = Symbol.for('seerrng.engine.owned-test-configs');
if (!process[owner]) {
  process[owner] = new Set();
  process.once('exit', () => {
    for (const path of process[owner]) {
      const stat = lstatSync(path);
      if (
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        basename(path).startsWith(prefix) &&
        realpathSync(dirname(path)) === realpathSync(tmpdir())
      )
        rmSync(path, { recursive: true });
    }
  });
}
process[owner].add(directory);
