// Copyright (c) snapetech and SeerrNG contributors.
// Secret-free, deterministic configuration for distributed validation workers.
import {
  BROKER_WORKER_CONFIG_SCHEMA,
  createBrokerWorkerConfig,
} from './broker-protocol.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_WORKER_CONFIG_SCHEMA =
  'seerrng-distributed-worker-config/v1';
export const DISTRIBUTED_BROKER_HANDOFF_SCHEMA =
  'seerrng-distributed-broker-handoff/v1';
export const DEFAULT_DISTRIBUTED_WORKER_CONFIG_PATH =
  'tools/validation-engine/distributed-workers.json';
export const MAX_DISTRIBUTED_WORKER_CONFIG_BYTES = 128 * 1024;
export const MAX_DISTRIBUTED_WORKER_THREADS = 256;
export const MAX_DISTRIBUTED_WORKERS = 256;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const INPUT_KEYS = [
  'controllerId',
  'controllerWorkerId',
  'revision',
  'schema',
  'workers',
];
const SEALED_KEYS = [...INPUT_KEYS, 'configSha256'];
const WORKER_KEYS = ['address', 'enabled', 'id', 'identitySha256', 'n'];
const BROKER_HANDOFF_KEYS = [
  'brokerWorkerConfig',
  'brokerWorkerPolicySha256',
  'handoffSha256',
  'schema',
  'sourceConfig',
];

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const sorted = actual.toSorted(compareText);
  const wanted = [...expected].toSorted(compareText);
  if (
    sorted.length !== wanted.length ||
    sorted.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function exactText(value, label, maximum = 2048) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > maximum ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Config values cross machines.
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(
      `${label} must be a positive integer not greater than ${maximum}`
    );
  return value;
}

function workerAddress(value) {
  exactText(value, 'worker HTTPS address');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Worker address must be a canonical HTTPS origin');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.origin !== value ||
    !parsed.hostname ||
    parsed.hostname.includes('*') ||
    parsed.hostname.endsWith('.') ||
    parsed.port === '0' ||
    ['0.0.0.0', '[::]'].includes(parsed.hostname)
  )
    throw new Error('Worker address must be a canonical HTTPS origin');
  return parsed.origin;
}

function configuredN(value) {
  if (value === 'auto') return value;
  return positiveInteger(
    value,
    'Explicit worker N',
    MAX_DISTRIBUTED_WORKER_THREADS
  );
}

function normalizeWorker(value) {
  exactKeys(value, WORKER_KEYS, 'distributed worker configuration');
  if (typeof value.enabled !== 'boolean')
    throw new Error('Distributed worker enabled state must be boolean');
  return {
    id: identifier(value.id, 'distributed worker ID'),
    address: workerAddress(value.address),
    enabled: value.enabled,
    identitySha256: digest(
      value.identitySha256,
      'distributed worker public identity fingerprint'
    ),
    n: configuredN(value.n),
  };
}

function normalizeInput(value) {
  exactKeys(value, INPUT_KEYS, 'distributed worker config');
  if (value.schema !== DISTRIBUTED_WORKER_CONFIG_SCHEMA)
    throw new Error('Unsupported distributed worker config schema');
  if (!Array.isArray(value.workers) || value.workers.length === 0)
    throw new Error('Distributed worker config must list every worker');
  if (value.workers.length > MAX_DISTRIBUTED_WORKERS)
    throw new Error(
      `Distributed worker config exceeds ${MAX_DISTRIBUTED_WORKERS} workers`
    );
  const workers = value.workers
    .map(normalizeWorker)
    .toSorted((left, right) => compareText(left.id, right.id));
  for (const [field, values] of [
    ['ID', workers.map((worker) => worker.id)],
    ['address', workers.map((worker) => worker.address)],
    ['identity fingerprint', workers.map((worker) => worker.identitySha256)],
  ])
    if (new Set(values).size !== values.length)
      throw new Error(
        `Distributed worker config contains a duplicate ${field}`
      );
  const controllerId = identifier(
    value.controllerId,
    'configured controller ID'
  );
  if (workers.some((worker) => worker.id === controllerId))
    throw new Error(
      'Configured controller ID must be distinct from every worker ID'
    );
  const controllerWorkerId =
    value.controllerWorkerId === null
      ? null
      : identifier(
          value.controllerWorkerId,
          'configured controller-local worker ID'
        );
  if (controllerWorkerId !== null) {
    const controllerWorker = workers.find(
      (worker) => worker.id === controllerWorkerId
    );
    if (!controllerWorker)
      throw new Error(
        'Configured controller-local worker must reference a listed worker'
      );
    if (!controllerWorker.enabled)
      throw new Error('Configured controller-local worker must be enabled');
  }
  return {
    schema: DISTRIBUTED_WORKER_CONFIG_SCHEMA,
    revision: positiveInteger(value.revision, 'Worker config revision'),
    controllerId,
    controllerWorkerId,
    workers,
  };
}

function sealConfig(value) {
  const normalized = normalizeInput(value);
  if (
    Buffer.byteLength(JSON.stringify(normalized), 'utf8') >
    MAX_DISTRIBUTED_WORKER_CONFIG_BYTES
  )
    throw new Error('Distributed worker config exceeds its safe limit');
  return deepFreeze({
    ...normalized,
    configSha256: canonicalJsonSha256(normalized),
  });
}

// A small strict JSON reader rejects duplicate decoded object keys instead of
// allowing JSON.parse's last-key-wins behavior to alter security policy.
function strictJson(text) {
  if (typeof text !== 'string')
    throw new Error('Distributed worker config JSON must be text');
  if (
    Buffer.byteLength(text, 'utf8') > MAX_DISTRIBUTED_WORKER_CONFIG_BYTES
  )
    throw new Error('Distributed worker config JSON exceeds its safe limit');
  let offset = 0;
  const whitespace = () => {
    while (/[\u0009\u000a\u000d\u0020]/.test(text[offset] ?? ''))
      offset += 1;
  };
  const fail = () => {
    throw new Error('Distributed worker config is not valid strict JSON');
  };
  const string = () => {
    if (text[offset] !== '"') fail();
    const begin = offset++;
    let escaped = false;
    while (offset < text.length) {
      const character = text[offset++];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        try {
          return JSON.parse(text.slice(begin, offset));
        } catch {
          fail();
        }
      }
      if (character.charCodeAt(0) < 0x20) fail();
    }
    fail();
  };
  const value = () => {
    whitespace();
    if (text[offset] === '{') {
      offset += 1;
      whitespace();
      const result = Object.create(null);
      const keys = new Set();
      if (text[offset] === '}') {
        offset += 1;
        return result;
      }
      while (offset < text.length) {
        const key = string();
        if (keys.has(key))
          throw new Error(`Distributed worker config repeats JSON key: ${key}`);
        keys.add(key);
        whitespace();
        if (text[offset++] !== ':') fail();
        result[key] = value();
        whitespace();
        const separator = text[offset++];
        if (separator === '}') return result;
        if (separator !== ',') fail();
        whitespace();
      }
      fail();
    }
    if (text[offset] === '[') {
      offset += 1;
      whitespace();
      const result = [];
      if (text[offset] === ']') {
        offset += 1;
        return result;
      }
      while (offset < text.length) {
        result.push(value());
        whitespace();
        const separator = text[offset++];
        if (separator === ']') return result;
        if (separator !== ',') fail();
      }
      fail();
    }
    if (text[offset] === '"') return string();
    for (const [token, decoded] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ])
      if (text.startsWith(token, offset)) {
        offset += token.length;
        return decoded;
      }
    const match = text
      .slice(offset)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail();
    offset += match[0].length;
    const decoded = Number(match[0]);
    if (!Number.isFinite(decoded)) fail();
    return decoded;
  };
  const decoded = value();
  whitespace();
  if (offset !== text.length) fail();
  return decoded;
}

export function createDistributedWorkerConfig(value) {
  return sealConfig(value);
}

export function parseDistributedWorkerConfig(text) {
  return sealConfig(strictJson(text));
}

export function verifyDistributedWorkerConfig(value) {
  exactKeys(value, SEALED_KEYS, 'sealed distributed worker config');
  const { configSha256, ...input } = value;
  const sealed = sealConfig(input);
  if (configSha256 !== sealed.configSha256)
    throw new Error(
      'Distributed worker config hash does not match its contents'
    );
  return sealed;
}

export function configuredDistributedWorker(configValue, workerId) {
  const config = verifyDistributedWorkerConfig(configValue);
  const worker = config.workers.find((entry) => entry.id === workerId);
  if (!worker) throw new Error(`Unknown distributed worker: ${workerId}`);
  if (!worker.enabled)
    throw new Error(`Distributed worker is disabled: ${workerId}`);
  return worker;
}

export function distributedWorkerConcurrency(configValue, workerId) {
  const worker = configuredDistributedWorker(configValue, workerId);
  return deepFreeze(
    worker.n === 'auto'
      ? { mode: 'auto' }
      : { mode: 'explicit', threads: worker.n }
  );
}

export function distributedWorkerRole(configValue, workerId) {
  const config = verifyDistributedWorkerConfig(configValue);
  configuredDistributedWorker(config, workerId);
  return 'worker';
}

export function distributedWorkerRunsOnControllerHost(configValue, workerId) {
  const config = verifyDistributedWorkerConfig(configValue);
  const worker = configuredDistributedWorker(config, workerId);
  return config.controllerWorkerId === worker.id;
}

function createBrokerWorkerPolicy(config) {
  return createBrokerWorkerConfig({
    schema: BROKER_WORKER_CONFIG_SCHEMA,
    controllerId: config.controllerId,
    workers: config.workers.map((worker) => ({
      workerId: worker.id,
      machineIdentitySha256: worker.identitySha256,
      enabled: worker.enabled,
      configuredN: worker.n,
    })),
  });
}

function sealBrokerHandoff(config) {
  const brokerWorkerConfig = createBrokerWorkerPolicy(config);
  const binding = {
    schema: DISTRIBUTED_BROKER_HANDOFF_SCHEMA,
    sourceConfig: config,
    brokerWorkerConfig,
    brokerWorkerPolicySha256: canonicalJsonSha256(brokerWorkerConfig),
  };
  return deepFreeze({
    ...binding,
    handoffSha256: canonicalJsonSha256(binding),
  });
}

// The broker consumes brokerWorkerConfig. The surrounding handoff deliberately
// retains the complete source inventory and names the reduced policy hash
// separately so it cannot be mistaken for sourceConfig.configSha256.
export function createDistributedBrokerHandoff(configValue) {
  const config = verifyDistributedWorkerConfig(configValue);
  return sealBrokerHandoff(config);
}

export function verifyDistributedBrokerHandoff(value) {
  exactKeys(value, BROKER_HANDOFF_KEYS, 'distributed broker handoff');
  if (value.schema !== DISTRIBUTED_BROKER_HANDOFF_SCHEMA)
    throw new Error('Unsupported distributed broker handoff schema');
  const sourceConfig = verifyDistributedWorkerConfig(value.sourceConfig);
  const expected = sealBrokerHandoff(sourceConfig);
  if (canonicalJsonSha256(value) !== canonicalJsonSha256(expected))
    throw new Error(
      'Distributed broker handoff does not match its source configuration'
    );
  return expected;
}

export function distributedBrokerWorkerHandoff(configValue, workerId) {
  const config = verifyDistributedWorkerConfig(configValue);
  const worker = configuredDistributedWorker(config, workerId);
  const handoff = sealBrokerHandoff(config);
  const brokerWorker = handoff.brokerWorkerConfig.workers.find(
    (entry) => entry.workerId === worker.id
  );
  if (!brokerWorker?.enabled)
    throw new Error(`Distributed worker is disabled: ${workerId}`);
  return deepFreeze({
    workerId: worker.id,
    workerAddress: worker.address,
    machineIdentitySha256: worker.identitySha256,
    configuredN: worker.n,
    role: distributedWorkerRole(config, worker.id),
    runsOnControllerHost: distributedWorkerRunsOnControllerHost(
      config,
      worker.id
    ),
    sourceConfigRevision: config.revision,
    sourceConfigSha256: config.configSha256,
    brokerWorkerConfig: handoff.brokerWorkerConfig,
    brokerWorkerPolicySha256: handoff.brokerWorkerPolicySha256,
    brokerHandoffSha256: handoff.handoffSha256,
  });
}

function configPath(value, label) {
  return exactText(value, label, 32_768);
}

export function resolveDistributedWorkerConfigPath({
  explicitPath = null,
  defaultPath = DEFAULT_DISTRIBUTED_WORKER_CONFIG_PATH,
  defaultAvailable = false,
} = {}) {
  if (typeof defaultAvailable !== 'boolean')
    throw new Error('Default config availability must be boolean');
  if (explicitPath !== null)
    return deepFreeze({
      source: 'explicit',
      path: configPath(explicitPath, 'explicit distributed config path'),
    });
  if (!defaultAvailable)
    throw new Error(
      'Distributed mode requires an explicit config or the documented default'
    );
  return deepFreeze({
    source: 'default',
    path: configPath(defaultPath, 'default distributed config path'),
  });
}
