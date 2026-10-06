// Copyright (c) snapetech and SeerrNG contributors.
// Strict, inert full-catalog handoff for distributed validation CLI boundaries.
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { isAbsolute } from 'node:path';
import { TextDecoder } from 'node:util';
import { MAX_DISTRIBUTED_NATIVE_TASKS } from './distributed-native-adapter.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_TASK_MANIFEST_SCHEMA =
  'seerrng-distributed-task-manifest/v1';
export const MAX_DISTRIBUTED_TASK_MANIFEST_BYTES = 8 * 1024 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const JSON_WHITESPACE = new Set([0x09, 0x0a, 0x0d, 0x20]);
const MANIFEST_CORE_KEYS = [
  'applicationId',
  'candidateSha256',
  'catalogSha256',
  'inventorySha256',
  'platform',
  'schema',
  'taskCount',
  'taskIds',
];
const MANIFEST_KEYS = [...MANIFEST_CORE_KEYS, 'manifestSha256'];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function minimumTaskCount(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('Distributed task manifest minimum must be positive');
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Distributed task manifest requires an exact ${label}`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Distributed task manifest requires an exact ${label}`);
  return value;
}

function normalizeTaskIds(value, { minimum = 1, canonical = false } = {}) {
  minimum = minimumTaskCount(minimum);
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > MAX_DISTRIBUTED_NATIVE_TASKS
  )
    throw new Error('Distributed task manifest has an invalid task count');
  if (
    value.some((taskId) => typeof taskId !== 'string' || !HASH64.test(taskId))
  )
    throw new Error(
      'Distributed task manifest IDs must be lowercase SHA-256 hashes'
    );
  if (new Set(value).size !== value.length)
    throw new Error('Distributed task manifest IDs must be unique');
  const sorted = [...value].toSorted();
  if (canonical && sorted.some((taskId, index) => taskId !== value[index]))
    throw new Error('Distributed task manifest IDs must use canonical order');
  return sorted;
}

function exactManifestKeys(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Distributed task manifest must be an object');
  const actual = Object.keys(value).toSorted();
  const expected = [...MANIFEST_KEYS].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error('Distributed task manifest requires its exact field set');
}

function strictJson(text) {
  if (typeof text !== 'string')
    throw new Error('Distributed task manifest JSON must be text');
  if (text.charCodeAt(0) === 0xfeff)
    throw new Error('Distributed task manifest JSON must not contain a BOM');
  if (Buffer.byteLength(text, 'utf8') > MAX_DISTRIBUTED_TASK_MANIFEST_BYTES)
    throw new Error('Distributed task manifest exceeds its safe byte limit');
  let offset = 0;
  const whitespace = () => {
    while (JSON_WHITESPACE.has(text.charCodeAt(offset))) offset += 1;
  };
  const fail = () => {
    throw new Error('Distributed task manifest is not valid strict JSON');
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
          throw new Error('Distributed task manifest repeats JSON key: ' + key);
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

export function verifyDistributedTaskManifest(value, options = {}) {
  exactManifestKeys(value);
  if (value.schema !== DISTRIBUTED_TASK_MANIFEST_SCHEMA)
    throw new Error('Unsupported distributed task manifest schema');
  const applicationId = identifier(value.applicationId, 'application ID');
  const platform = identifier(value.platform, 'platform');
  const candidateSha256 = digest(value.candidateSha256, 'candidate hash');
  const catalogSha256 = digest(value.catalogSha256, 'catalog hash');
  const inventorySha256 = digest(value.inventorySha256, 'inventory hash');
  const taskIds = normalizeTaskIds(value.taskIds, {
    minimum: options.minimum,
    canonical: true,
  });
  if (
    !Number.isSafeInteger(value.taskCount) ||
    value.taskCount !== taskIds.length
  )
    throw new Error('Distributed task manifest task count is invalid');
  if (
    typeof value.manifestSha256 !== 'string' ||
    !HASH64.test(value.manifestSha256)
  )
    throw new Error('Distributed task manifest requires an exact SHA-256 seal');
  const core = {
    schema: value.schema,
    applicationId,
    platform,
    candidateSha256,
    catalogSha256,
    inventorySha256,
    taskCount: value.taskCount,
    taskIds,
  };
  if (value.manifestSha256 !== canonicalJsonSha256(core))
    throw new Error('Distributed task manifest seal is invalid');
  return deepFreeze({ ...core, manifestSha256: value.manifestSha256 });
}

export function createDistributedTaskManifest(catalog, options = {}) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog))
    throw new Error('Distributed task manifest requires a discovered catalog');
  if (!Array.isArray(catalog.tasks))
    throw new Error('Distributed task manifest requires catalog tasks');
  const taskIds = normalizeTaskIds(
    catalog.tasks.map((task) => task?.taskId),
    { minimum: options.minimum }
  );
  const core = {
    schema: DISTRIBUTED_TASK_MANIFEST_SCHEMA,
    applicationId: identifier(catalog.applicationId, 'application ID'),
    platform: identifier(catalog.platform, 'platform'),
    candidateSha256: digest(
      catalog.candidate?.candidateSha256,
      'candidate hash'
    ),
    catalogSha256: digest(catalog.catalogSha256, 'catalog hash'),
    inventorySha256: digest(catalog.inventorySha256, 'inventory hash'),
    taskCount: taskIds.length,
    taskIds,
  };
  return verifyDistributedTaskManifest(
    { ...core, manifestSha256: canonicalJsonSha256(core) },
    options
  );
}

export function verifyDistributedTaskManifestCatalog(
  manifestValue,
  catalog,
  options = {}
) {
  const manifest = verifyDistributedTaskManifest(manifestValue, options);
  const expected = createDistributedTaskManifest(catalog, options);
  for (const key of MANIFEST_CORE_KEYS)
    if (
      key === 'taskIds'
        ? expected.taskIds.some(
            (taskId, index) => taskId !== manifest.taskIds[index]
          )
        : manifest[key] !== expected[key]
    )
      throw new Error(
        `Distributed task manifest does not match the full local catalog (${key})`
      );
  return manifest;
}

export function parseDistributedTaskManifest(text, options = {}) {
  return verifyDistributedTaskManifest(strictJson(text), options);
}

export function readDistributedTaskManifest(path, options = {}) {
  if (typeof path !== 'string' || !isAbsolute(path))
    throw new Error('Distributed task manifest path must be absolute');
  let entry;
  try {
    entry = lstatSync(path);
  } catch (error) {
    throw new Error('Distributed task manifest must be an existing file', {
      cause: error,
    });
  }
  if (entry.isSymbolicLink())
    throw new Error(
      'Distributed task manifest must not be a symlink or reparse point'
    );
  if (!entry.isFile())
    throw new Error('Distributed task manifest must be a regular file');
  if (entry.size > MAX_DISTRIBUTED_TASK_MANIFEST_BYTES)
    throw new Error('Distributed task manifest exceeds its safe byte limit');

  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== entry.dev ||
      opened.ino !== entry.ino
    )
      throw new Error('Distributed task manifest changed during admission');
    if (opened.size > MAX_DISTRIBUTED_TASK_MANIFEST_BYTES)
      throw new Error('Distributed task manifest exceeds its safe byte limit');
    const bytes = readFileSync(descriptor);
    const completed = fstatSync(descriptor);
    if (
      completed.dev !== opened.dev ||
      completed.ino !== opened.ino ||
      completed.size !== bytes.byteLength
    )
      throw new Error('Distributed task manifest changed while being read');
    if (bytes.byteLength > MAX_DISTRIBUTED_TASK_MANIFEST_BYTES)
      throw new Error('Distributed task manifest exceeds its safe byte limit');
    if (
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    )
      throw new Error('Distributed task manifest JSON must not contain a BOM');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      throw new Error('Distributed task manifest must be valid UTF-8', {
        cause: error,
      });
    }
    return parseDistributedTaskManifest(text, options);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
