// Copyright (c) snapetech and SeerrNG contributors.
// Authentication-neutral controller intent for one worker-directed command.
import {
  MAX_BROKER_MESSAGE_BYTES,
  assertAuthenticatedBrokerMessage,
  brokerApplicationIsolationKeySha256,
  verifyBrokerBinding,
  verifyBrokerLogicalCommand,
} from './broker-protocol.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_SCHEMA =
  'seerrng-distributed-controller-dispatch-intent/v1';
// The final authenticated broker envelope must still pass its own mandatory
// message cap. This smaller intent limit reserves conservative room for that
// envelope's schema, message identity, authentication, and send-time fields.
export const DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_HEADROOM_BYTES = 64 * 1024;
export const MAX_DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_BYTES =
  MAX_BROKER_MESSAGE_BYTES -
  DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_HEADROOM_BYTES;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTROLLER_TO_WORKER_KINDS = new Set([
  'lease.grant',
  'lease.renew',
  'lease.cancel',
  'result.ack',
]);
const CREATE_KEYS = ['binding', 'body', 'command', 'kind'];
const INTENT_KEYS = [
  'applicationIsolationKeySha256',
  'binding',
  'body',
  'command',
  'intentSha256',
  'kind',
  'schema',
  'targetWorkerId',
];
const EXPECTATION_KEYS = [
  'expectedBinding',
  'expectedCommandSha256',
  'expectedWorkerId',
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

function exactKeys(value, expectedKeys, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const expected = [...expectedKeys].toSorted(compareText);
  const sorted = actual.toSorted(compareText);
  if (
    sorted.length !== expected.length ||
    sorted.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function assertJsonBytes(value, label, maximumBytes) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must contain JSON values only`);
  }
  const bytes = Buffer.byteLength(encoded, 'utf8');
  if (bytes > maximumBytes)
    throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  return bytes;
}

function normalizeSources(value) {
  if (!CONTROLLER_TO_WORKER_KINDS.has(value.kind))
    throw new Error(
      'Dispatch intent requires a supported controller-to-worker command'
    );
  const binding = verifyBrokerBinding(value.binding);
  const command = verifyBrokerLogicalCommand(value.command, {
    expectedBinding: binding,
    expectedKind: value.kind,
    expectedBody: value.body,
  });
  const body = structuredClone(value.body);
  if (canonicalJsonSha256(body) !== command.bodySha256)
    throw new Error(
      'Dispatch intent body must be the exact normalized logical-command body'
    );
  const applicationIsolationKeySha256 =
    brokerApplicationIsolationKeySha256(binding);
  if (
    value.kind === 'lease.grant' &&
    body.task.applicationIsolationKeySha256 !== applicationIsolationKeySha256
  )
    throw new Error(
      'Dispatch-intent lease task crossed an application isolation boundary'
    );
  const targetWorkerId = identifier(
    body.workerId,
    'dispatch-intent target worker ID'
  );
  return {
    schema: DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_SCHEMA,
    binding,
    applicationIsolationKeySha256,
    kind: value.kind,
    targetWorkerId,
    command,
    body,
  };
}

function sealIntent(value) {
  const intent = {
    ...value,
    intentSha256: canonicalJsonSha256(value),
  };
  assertJsonBytes(
    intent,
    'Sealed controller dispatch intent',
    MAX_DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_BYTES
  );
  return deepFreeze(intent);
}

export function createDistributedControllerDispatchIntent(value) {
  exactKeys(value, CREATE_KEYS, 'controller dispatch-intent creation input');
  assertJsonBytes(
    value,
    'Controller dispatch-intent creation source',
    MAX_DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_BYTES
  );
  return sealIntent(normalizeSources(value));
}

export function verifyDistributedControllerDispatchIntent(
  value,
  expectations
) {
  exactKeys(value, INTENT_KEYS, 'sealed controller dispatch intent');
  exactKeys(
    expectations,
    EXPECTATION_KEYS,
    'controller dispatch-intent expectations'
  );
  if (value.schema !== DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_SCHEMA)
    throw new Error('Unsupported controller dispatch-intent schema');
  const expected = sealIntent(
    normalizeSources({
      binding: value.binding,
      body: value.body,
      command: value.command,
      kind: value.kind,
    })
  );
  if (
    value.applicationIsolationKeySha256 !==
    expected.applicationIsolationKeySha256
  )
    throw new Error('Controller dispatch intent crossed an application boundary');
  if (value.targetWorkerId !== expected.targetWorkerId)
    throw new Error('Controller dispatch-intent target worker drifted');
  digest(value.intentSha256, 'controller dispatch-intent hash');
  if (value.intentSha256 !== expected.intentSha256)
    throw new Error('Controller dispatch-intent seal does not match its contents');

  const expectedBinding = verifyBrokerBinding(expectations.expectedBinding);
  if (
    canonicalJsonSha256(expected.binding) !==
    canonicalJsonSha256(expectedBinding)
  )
    throw new Error('Controller dispatch intent has an unexpected binding');
  if (
    expected.command.commandSha256 !==
    digest(expectations.expectedCommandSha256, 'expected command hash')
  )
    throw new Error('Controller dispatch intent has an unexpected command');
  if (
    expected.targetWorkerId !==
    identifier(expectations.expectedWorkerId, 'expected target worker ID')
  )
    throw new Error('Controller dispatch intent has an unexpected target worker');
  return expected;
}

export function distributedControllerDispatchIntentFromAuthenticatedMessage(
  value
) {
  const message = assertAuthenticatedBrokerMessage(value);
  return createDistributedControllerDispatchIntent({
    binding: message.binding,
    kind: message.kind,
    command: message.command,
    body: message.body,
  });
}
