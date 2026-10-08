#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot =
  process.env.VROOM_FIXTURE_ROOT ??
  process.env.CONFIG_DIRECTORY ??
  path.join(root, 'cypress/runtime-config');
const servicePort = process.env.VROOM_SERVICE_PORT ?? process.env.PORT;
const result = spawnSync(process.execPath, ['dist/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    CONFIG_DIRECTORY: fixtureRoot,
    E2E_TESTS: 'true',
    NODE_ENV: 'production',
    ...(servicePort ? { PORT: servicePort } : {}),
    SEERR_SKIP_DB_MIGRATIONS: 'true',
  },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
