import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import { MAX_DISTRIBUTED_NATIVE_TASKS } from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import {
  createDistributedTaskManifest,
  DISTRIBUTED_TASK_MANIFEST_SCHEMA,
  MAX_DISTRIBUTED_TASK_MANIFEST_BYTES,
  parseDistributedTaskManifest,
  readDistributedTaskManifest,
  verifyDistributedTaskManifest,
  verifyDistributedTaskManifestCatalog,
} from '../tools/validation-engine/runtime/distributed-task-manifest.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const firstTaskId = '1'.repeat(64);
const secondTaskId = '2'.repeat(64);
const catalog = (taskIds = [secondTaskId, firstTaskId]) => ({
  applicationId: 'seerrng',
  platform: 'linux',
  candidate: { candidateSha256: 'a'.repeat(64) },
  catalogSha256: 'b'.repeat(64),
  inventorySha256: 'c'.repeat(64),
  tasks: taskIds.map((taskId) => ({ taskId })),
});

test('task manifest seals one canonical full-catalog binding', () => {
  const discovered = catalog();
  const manifest = createDistributedTaskManifest(discovered, {
    minimum: 2,
  });
  const core = {
    schema: DISTRIBUTED_TASK_MANIFEST_SCHEMA,
    applicationId: 'seerrng',
    platform: 'linux',
    candidateSha256: 'a'.repeat(64),
    catalogSha256: 'b'.repeat(64),
    inventorySha256: 'c'.repeat(64),
    taskCount: 2,
    taskIds: [firstTaskId, secondTaskId],
  };
  assert.deepEqual(manifest, {
    ...core,
    manifestSha256: canonicalJsonSha256(core),
  });
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.taskIds), true);
  assert.deepEqual(
    parseDistributedTaskManifest(JSON.stringify(manifest), { minimum: 2 }),
    manifest
  );
  assert.deepEqual(
    verifyDistributedTaskManifestCatalog(manifest, discovered, {
      minimum: 2,
    }),
    manifest
  );
});

test('task manifest rejects noncanonical, ambiguous, or unsealed JSON', () => {
  const valid = createDistributedTaskManifest(catalog(), {
    minimum: 2,
  });
  const cases = [
    {
      value: '\uFEFF' + JSON.stringify(valid),
      pattern: /must not contain a BOM/,
    },
    {
      value: '/* comment */' + JSON.stringify(valid),
      pattern: /not valid strict JSON/,
    },
    {
      value: JSON.stringify(valid) + ' trailing',
      pattern: /not valid strict JSON/,
    },
    {
      value: JSON.stringify({ ...valid, unknown: true }),
      pattern: /exact field set/,
    },
    {
      value: JSON.stringify({ ...valid, schema: 'unsupported' }),
      pattern: /Unsupported/,
    },
    {
      value: JSON.stringify({
        ...valid,
        manifestSha256: 'f'.repeat(64),
      }),
      pattern: /seal is invalid/,
    },
    {
      value: JSON.stringify({
        ...valid,
        taskIds: [secondTaskId, firstTaskId],
      }),
      pattern: /canonical order/,
    },
    {
      value: JSON.stringify({
        ...valid,
        taskIds: [firstTaskId, firstTaskId],
      }),
      pattern: /must be unique/,
    },
    {
      value: JSON.stringify({
        ...valid,
        taskIds: ['A'.repeat(64), secondTaskId],
      }),
      pattern: /lowercase SHA-256/,
    },
    {
      value: JSON.stringify({
        ...valid,
        taskCount: 1,
      }),
      pattern: /task count is invalid/,
    },
    {
      value:
        '{"schema":"' +
        DISTRIBUTED_TASK_MANIFEST_SCHEMA +
        '","\\u0073chema":"' +
        DISTRIBUTED_TASK_MANIFEST_SCHEMA +
        '","taskIds":' +
        JSON.stringify(valid.taskIds) +
        ',"manifestSha256":"' +
        valid.manifestSha256 +
        '"}',
      pattern: /repeats JSON key: schema/,
    },
  ];
  for (const { value, pattern } of cases)
    assert.throws(() => parseDistributedTaskManifest(value), pattern);

  assert.throws(
    () =>
      parseDistributedTaskManifest(
        JSON.stringify(createDistributedTaskManifest(catalog([firstTaskId]))),
        { minimum: 2 }
      ),
    /invalid task count/
  );
  assert.throws(
    () => createDistributedTaskManifest(catalog([])),
    /invalid task count/
  );
  assert.throws(
    () =>
      createDistributedTaskManifest(
        catalog(
          Array.from({ length: MAX_DISTRIBUTED_NATIVE_TASKS + 1 }, (_, index) =>
            index.toString(16).padStart(64, '0')
          )
        )
      ),
    /invalid task count/
  );
  assert.throws(() => verifyDistributedTaskManifest(null), /must be an object/);
});

test('task manifest rejects every full-catalog provenance mismatch', () => {
  const discovered = catalog();
  const manifest = createDistributedTaskManifest(discovered);
  const mismatches = [
    ['applicationId', { applicationId: 'other' }],
    ['platform', { platform: 'win32' }],
    ['candidateSha256', { candidate: { candidateSha256: 'd'.repeat(64) } }],
    ['catalogSha256', { catalogSha256: 'd'.repeat(64) }],
    ['inventorySha256', { inventorySha256: 'd'.repeat(64) }],
    ['taskCount', { tasks: [{ taskId: firstTaskId }] }],
    [
      'taskIds',
      { tasks: [{ taskId: firstTaskId }, { taskId: '3'.repeat(64) }] },
    ],
  ];
  for (const [field, patch] of mismatches)
    assert.throws(
      () =>
        verifyDistributedTaskManifestCatalog(manifest, {
          ...discovered,
          ...patch,
        }),
      new RegExp(`full local catalog \\(${field}\\)`)
    );
});

test('task manifest reader admits only bounded absolute regular files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-task-manifest-'));
  try {
    const manifest = createDistributedTaskManifest(catalog(), { minimum: 2 });
    const manifestFile = join(directory, 'tasks.json');
    writeFileSync(manifestFile, JSON.stringify(manifest) + '\n');
    assert.deepEqual(
      readDistributedTaskManifest(manifestFile, { minimum: 2 }),
      manifest
    );
    assert.throws(
      () => readDistributedTaskManifest('tasks.json'),
      /path must be absolute/
    );
    assert.throws(
      () => readDistributedTaskManifest(join(directory, 'missing.json')),
      /existing file/
    );
    assert.throws(() => readDistributedTaskManifest(directory), /regular file/);

    const targetDirectory = join(directory, 'target');
    const link = join(directory, 'manifest-link');
    mkdirSync(targetDirectory);
    symlinkSync(
      targetDirectory,
      link,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    assert.throws(
      () => readDistributedTaskManifest(link),
      /symlink or reparse point/
    );

    const oversized = join(directory, 'oversized.json');
    writeFileSync(
      oversized,
      Buffer.alloc(MAX_DISTRIBUTED_TASK_MANIFEST_BYTES + 1, 0x20)
    );
    assert.throws(
      () => readDistributedTaskManifest(oversized),
      /safe byte limit/
    );

    const bom = join(directory, 'bom.json');
    writeFileSync(
      bom,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')])
    );
    assert.throws(
      () => readDistributedTaskManifest(bom),
      /must not contain a BOM/
    );

    const invalidUtf8 = join(directory, 'invalid-utf8.json');
    writeFileSync(invalidUtf8, Buffer.from([0xc3, 0x28]));
    assert.throws(
      () => readDistributedTaskManifest(invalidUtf8),
      /valid UTF-8/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
