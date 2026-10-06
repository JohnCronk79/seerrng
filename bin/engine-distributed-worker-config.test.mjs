import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import {
  assessDistributedWorkerCapacity,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import {
  createDistributedBrokerHandoff,
  createDistributedWorkerConfig,
  distributedBrokerWorkerHandoff,
  distributedWorkerConcurrency,
  distributedWorkerRole,
  MAX_DISTRIBUTED_WORKER_CONFIG_BYTES,
  MAX_DISTRIBUTED_WORKER_THREADS,
  MAX_DISTRIBUTED_WORKERS,
  parseDistributedWorkerConfig,
  resolveDistributedWorkerConfigPath,
  verifyDistributedBrokerHandoff,
  verifyDistributedWorkerConfig,
} from '../tools/validation-engine/runtime/distributed-worker-config.mjs';

const h = (character) => character.repeat(64);
const rawConfig = (workers, { controllerWorkerId = null } = {}) => ({
  schema: 'seerrng-distributed-worker-config/v1',
  revision: 1,
  controllerId: 'developer-master',
  controllerWorkerId,
  workers,
});
const worker = ({
  id = 'worker-east',
  address = 'https://worker-east.lan:7443',
  enabled = true,
  identitySha256 = h('1'),
  n = 'auto',
} = {}) => ({ id, address, enabled, identitySha256, n });

test('example is strict, deterministic, secret-free, and has distinct N', () => {
  const example = readFileSync(
    fileURLToPath(
      new URL(
        '../tools/validation-engine/distributed-workers.example.json',
        import.meta.url
      )
    ),
    'utf8'
  );
  const first = parseDistributedWorkerConfig(example);
  const second = createDistributedWorkerConfig(
    rawConfig(
      [...first.workers].reverse().map(({ id, ...entry }) => ({
        ...entry,
        id,
      })),
      { controllerWorkerId: first.controllerWorkerId }
    )
  );
  assert.equal(first.configSha256, second.configSha256);
  assert.equal(first.controllerWorkerId, 'developer-main');
  assert.deepEqual(
    first.workers.map(({ id, n, enabled }) => ({ id, n, enabled })),
    [
      { id: 'developer-main', n: 'auto', enabled: true },
      { id: 'worker-east', n: 16, enabled: true },
      { id: 'worker-west', n: 8, enabled: false },
    ]
  );
  assert.equal(JSON.stringify(first).includes('secret'), false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.workers), true);
});

test('master config maps to broker and adaptive scheduler contracts', () => {
  const config = createDistributedWorkerConfig(
    rawConfig([
      worker({ n: 6 }),
      worker({
        id: 'worker-west',
        address: 'https://worker-west.lan:7443',
        identitySha256: h('2'),
        n: 'auto',
      }),
    ])
  );
  const handoff = createDistributedBrokerHandoff(config);
  const broker = handoff.brokerWorkerConfig;
  assert.deepEqual(verifyDistributedBrokerHandoff(handoff), handoff);
  assert.equal(handoff.sourceConfig.revision, config.revision);
  assert.equal(handoff.sourceConfig.configSha256, config.configSha256);
  assert.deepEqual(
    handoff.sourceConfig.workers.map(({ id, address }) => ({ id, address })),
    config.workers.map(({ id, address }) => ({ id, address }))
  );
  assert.equal(
    handoff.brokerWorkerPolicySha256 === handoff.sourceConfig.configSha256,
    false
  );
  assert.deepEqual(
    broker.workers.map(({ workerId, configuredN }) => ({
      workerId,
      configuredN,
    })),
    [
      { workerId: 'worker-east', configuredN: 6 },
      { workerId: 'worker-west', configuredN: 'auto' },
    ]
  );
  assert.deepEqual(distributedWorkerConcurrency(config, 'worker-east'), {
    mode: 'explicit',
    threads: 6,
  });
  assert.deepEqual(distributedWorkerConcurrency(config, 'worker-west'), {
    mode: 'auto',
  });
  assert.equal(distributedWorkerRole(config, 'worker-east'), 'worker');
  assert.equal(distributedWorkerRole(config, 'worker-west'), 'worker');
  const workerHandoff = distributedBrokerWorkerHandoff(
    config,
    'worker-east'
  );
  assert.equal(workerHandoff.workerAddress, 'https://worker-east.lan:7443');
  assert.equal(workerHandoff.role, 'worker');
  assert.equal(workerHandoff.sourceConfigRevision, 1);
  assert.equal(workerHandoff.sourceConfigSha256, config.configSha256);
  assert.equal(
    workerHandoff.brokerWorkerPolicySha256,
    handoff.brokerWorkerPolicySha256
  );
  assert.deepEqual(workerHandoff.brokerWorkerConfig, broker);
  const admitted = assessDistributedWorkerCapacity({
    id: 'worker-east',
    scope: { environment: 'linux-x64', workerClass: 'desktop' },
    effectiveLogicalThreads: 8,
    concurrency: distributedWorkerConcurrency(config, 'worker-east'),
    role: 'worker',
    currentLoadPermille: 0,
    benchmark: { valid: true, performanceScorePermille: 200 },
  });
  assert.equal(admitted.admittedThreads, 6);
  assert.equal(admitted.capacityWeight, 1200);
});

test('worker list rejects duplicate stable identities', () => {
  for (const [field, duplicate] of [
    [
      'ID',
      worker({
        address: 'https://worker-west.lan:7443',
        identitySha256: h('2'),
      }),
    ],
    ['address', worker({ id: 'worker-west', identitySha256: h('2') })],
    [
      'identity fingerprint',
      worker({
        id: 'worker-west',
        address: 'https://worker-west.lan:7443',
      }),
    ],
  ])
    assert.throws(
      () => createDistributedWorkerConfig(rawConfig([worker(), duplicate])),
      new RegExp(`duplicate ${field}`)
    );
});

test('controller identity must be distinct from every worker identity', () => {
  assert.throws(
    () =>
      createDistributedWorkerConfig({
        ...rawConfig([worker({ id: 'developer-master' })]),
      }),
    /controller ID must be distinct/
  );
});

test('controller-local worker binding is explicit, enabled, and keeps a distinct worker identity', () => {
  const workers = [
    worker(),
    worker({
      id: 'worker-west',
      address: 'https://worker-west.lan:7443',
      identitySha256: h('2'),
    }),
  ];
  const config = createDistributedWorkerConfig(
    rawConfig(workers, { controllerWorkerId: 'worker-east' })
  );
  assert.equal(config.controllerId, 'developer-master');
  assert.equal(config.controllerWorkerId, 'worker-east');
  assert.equal(distributedWorkerRole(config, 'worker-east'), 'controller');
  assert.equal(distributedWorkerRole(config, 'worker-west'), 'worker');
  assert.equal(
    distributedBrokerWorkerHandoff(config, 'worker-east').role,
    'controller'
  );

  assert.throws(
    () =>
      createDistributedWorkerConfig(
        rawConfig(workers, { controllerWorkerId: 'missing-worker' })
      ),
    /must reference a listed worker/
  );
  assert.throws(
    () =>
      createDistributedWorkerConfig(
        rawConfig([worker({ enabled: false })], {
          controllerWorkerId: 'worker-east',
        })
      ),
    /must be enabled/
  );
});

test('worker identity, address, enabled state, and N fail closed', () => {
  for (const [change, pattern] of [
    [{ address: 'http://worker-east.lan:7443' }, /canonical HTTPS origin/],
    [
      { address: 'https://user@worker-east.lan:7443' },
      /canonical HTTPS origin/,
    ],
    [
      { address: 'https://worker-east.lan:7443/path' },
      /canonical HTTPS origin/,
    ],
    [{ address: 'https://0.0.0.0:7443' }, /canonical HTTPS origin/],
    [{ address: 'https://worker-east.lan:0' }, /canonical HTTPS origin/],
    [{ address: 'https://worker-east.lan.:7443' }, /canonical HTTPS origin/],
    [{ enabled: 'yes' }, /enabled state/],
    [{ identitySha256: h('A') }, /public identity fingerprint/],
    [{ n: 0 }, /Explicit worker N/],
    [{ n: MAX_DISTRIBUTED_WORKER_THREADS + 1 }, /Explicit worker N/],
    [{ n: { mode: 'auto' } }, /Explicit worker N/],
  ])
    assert.throws(
      () => createDistributedWorkerConfig(rawConfig([worker(change)])),
      pattern
    );
});

test('disabled workers cannot receive concurrency or a broker handoff', () => {
  const config = createDistributedWorkerConfig(
    rawConfig([worker({ enabled: false })])
  );
  assert.throws(
    () => distributedWorkerConcurrency(config, 'worker-east'),
    /worker is disabled/
  );
  assert.throws(
    () => distributedBrokerWorkerHandoff(config, 'worker-east'),
    /worker is disabled/
  );
});

test('unknown fields and duplicate JSON keys cannot override policy', () => {
  assert.throws(
    () =>
      createDistributedWorkerConfig({
        ...rawConfig([worker()]),
        token: 'not-allowed',
      }),
    /exact field set/
  );
  assert.throws(
    () =>
      createDistributedWorkerConfig(
        rawConfig([{ ...worker(), privateKey: 'not-allowed' }])
      ),
    /exact field set/
  );
  assert.throws(
    () =>
      parseDistributedWorkerConfig(
        '{"schema":"seerrng-distributed-worker-config/v1",' +
          '"schema":"wrong","revision":1,"controllerId":"master",' +
          '"workers":[]}'
      ),
    /repeats JSON key: schema/
  );
  assert.throws(
    () =>
      parseDistributedWorkerConfig(
        '{"schema":"seerrng-distributed-worker-config/v1",' +
          '"revision":1,"controllerId":"master","workers":[{' +
          '"id":"worker","address":"https://worker.lan:7443",' +
          '"enabled":true,"identitySha256":"' +
          h('1') +
          '","n":"auto","\\u006e":4}]}'
      ),
    /repeats JSON key: n/
  );
});

test('sealed config detects later mutation or hash substitution', () => {
  const sealed = createDistributedWorkerConfig(rawConfig([worker()]));
  assert.deepEqual(verifyDistributedWorkerConfig(sealed), sealed);
  const changed = structuredClone(sealed);
  changed.workers[0].n = 4;
  assert.throws(() => verifyDistributedWorkerConfig(changed), /hash/);

  const handoff = structuredClone(createDistributedBrokerHandoff(sealed));
  handoff.sourceConfig.workers[0].address =
    'https://substituted-worker.lan:7443';
  assert.throws(
    () => verifyDistributedBrokerHandoff(handoff),
    /source configuration|hash/
  );
});

test('object and JSON entry points enforce the same semantic size limit', () => {
  const largeWorkers = Array.from(
    { length: MAX_DISTRIBUTED_WORKERS },
    (_, index) => {
      const suffix = index.toString(36).padStart(4, '0');
      const idPrefix = `worker-${suffix}-`;
      const id = `${idPrefix}${'x'.repeat(128 - idPrefix.length)}`;
      const hostname = [
        `w${suffix}`,
        ...Array.from({ length: 4 }, () => 'a'.repeat(60)),
        'lan',
      ].join('.');
      return worker({
        id,
        address: `https://${hostname}`,
        identitySha256: index.toString(16).padStart(64, '0'),
      });
    }
  );
  const largeConfig = rawConfig(largeWorkers);
  assert.equal(
    Buffer.byteLength(JSON.stringify(largeConfig), 'utf8') >
      MAX_DISTRIBUTED_WORKER_CONFIG_BYTES,
    true
  );
  assert.throws(
    () => createDistributedWorkerConfig(largeConfig),
    /exceeds its safe limit/
  );
  assert.throws(
    () => parseDistributedWorkerConfig(JSON.stringify(largeConfig)),
    /exceeds its safe limit/
  );
});

test('published schema mirrors every expressible runtime bound', () => {
  const schema = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          '../tools/validation-engine/distributed-workers.schema.json',
          import.meta.url
        )
      ),
      'utf8'
    )
  );
  assert.equal(schema.properties.revision.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(schema.properties.controllerId.maxLength, 128);
  assert.equal(
    schema.properties.controllerWorkerId.oneOf[1].maxLength,
    128
  );
  assert.equal(schema.properties.workers.maxItems, MAX_DISTRIBUTED_WORKERS);
  assert.equal(schema.properties.workers.uniqueItems, true);
  const workerSchema = schema.$defs.worker.properties;
  assert.equal(workerSchema.id.maxLength, 128);
  assert.equal(workerSchema.address.minLength, 9);
  assert.equal(workerSchema.address.maxLength, 2048);
  const addressPattern = new RegExp(workerSchema.address.pattern);
  assert.equal(addressPattern.test('https://worker-east.lan:7443'), true);
  assert.equal(addressPattern.test('https://user@worker-east.lan:7443'), false);
  assert.equal(addressPattern.test('https://worker-east.lan:7443/path'), false);
  assert.equal(workerSchema.identitySha256.minLength, 64);
  assert.equal(workerSchema.identitySha256.maxLength, 64);
  assert.equal(
    workerSchema.n.oneOf[1].maximum,
    MAX_DISTRIBUTED_WORKER_THREADS
  );
});

test('private default inventory is ignored exactly once', () => {
  const gitignore = readFileSync(
    fileURLToPath(new URL('../.gitignore', import.meta.url)),
    'utf8'
  );
  assert.equal(
    gitignore
      .split(/\r?\n/)
      .filter(
        (line) => line === '/tools/validation-engine/distributed-workers.json'
      ).length,
    1
  );
});

test('explicit config wins and default requires availability', () => {
  assert.deepEqual(
    resolveDistributedWorkerConfigPath({
      explicitPath: 'private/workers.json',
      defaultPath: 'default/workers.json',
      defaultAvailable: true,
    }),
    { source: 'explicit', path: 'private/workers.json' }
  );
  assert.deepEqual(
    resolveDistributedWorkerConfigPath({
      defaultPath: 'default/workers.json',
      defaultAvailable: true,
    }),
    { source: 'default', path: 'default/workers.json' }
  );
  assert.throws(
    () => resolveDistributedWorkerConfigPath(),
    /requires an explicit config or the documented default/
  );
});
