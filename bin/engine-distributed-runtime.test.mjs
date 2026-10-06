import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createTcpServer } from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import {
  createDistributedWorkerRuntime,
  DISTRIBUTED_PROBE_KIND,
  DISTRIBUTED_TASK_KIND,
  parseDistributedApplicationBindings,
  runDistributedControllerTask,
  startDistributedWorkerServer,
} from '../tools/validation-engine/runtime/distributed-runtime.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import {
  createDistributedNativeTaskRequest,
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
  MAX_DISTRIBUTED_NATIVE_TASKS,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import { distributedTrustedCertificateSha256 } from '../tools/validation-engine/runtime/distributed-trusted-transport.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import { createDistributedWorkerConfig } from '../tools/validation-engine/runtime/distributed-worker-config.mjs';

const applicationId = 'seerrng';
const adapterId = 'node';
const files = ['bin/engine-distributed-runtime.test.mjs'];
const root = resolve(process.cwd());
const sha256 = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
const candidateCore = {
  schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  commitSha: '1'.repeat(40),
  treeSha: '2'.repeat(40),
  lockfilePath: 'pnpm-lock.yaml',
  lockfileSha256: sha256('fixture-lockfile'),
};
const candidate = {
  ...candidateCore,
  candidateSha256: canonicalJsonSha256(candidateCore),
};
const candidateSha256 = candidate.candidateSha256;
const inventorySha256 = sha256('fixture-inventory');
const taskId = distributedNativeTaskId({ applicationId, adapterId, files });
const secondAdapterId = 'node-js';
const secondFiles = ['bin/engine-distributed-native-adapter.test.mjs'];
const secondTaskId = distributedNativeTaskId({
  applicationId,
  adapterId: secondAdapterId,
  files: secondFiles,
});
const taskDefinitions = new Map([
  [taskId, { adapterId, files }],
  [secondTaskId, { adapterId: secondAdapterId, files: secondFiles }],
]);

const config = ({
  address = 'https://worker-one.test:7443',
  identitySha256 = 'd'.repeat(64),
  controllerWorkerId = 'worker-one',
} = {}) =>
  createDistributedWorkerConfig({
    schema: 'seerrng-distributed-worker-config/v1',
    revision: 1,
    controllerId: 'controller',
    controllerWorkerId,
    workers: [
      {
        id: 'worker-one',
        address,
        enabled: true,
        identitySha256,
        n: 2,
      },
    ],
  });

const createCatalog = (
  selectedApplicationId = applicationId,
  selectedTaskIds = [taskId]
) => {
  const tasks = selectedTaskIds
    .map((selectedTaskId) => {
      const definition = taskDefinitions.get(selectedTaskId);
      assert.ok(definition, `Unknown fixture task: ${selectedTaskId}`);
      return {
        schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
        taskId: selectedTaskId,
        adapterId: definition.adapterId,
        files: [...definition.files],
      };
    })
    .toSorted((left, right) => left.taskId.localeCompare(right.taskId));
  const core = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId: selectedApplicationId,
    platform: process.platform,
    candidate,
    inventorySha256:
      tasks.length === 1 && tasks[0].taskId === taskId
        ? inventorySha256
        : sha256(tasks.map(({ taskId }) => taskId).join('\0')),
    tasks,
  };
  return {
    ...core,
    catalogSha256: canonicalJsonSha256(core),
  };
};

const catalog = (
  applicationRoot,
  { applicationId: selectedApplicationId, allowedTaskIds }
) => {
  assert.equal(applicationRoot, root);
  assert.deepEqual(allowedTaskIds, [taskId]);
  return createCatalog(selectedApplicationId);
};

const outputEvidence = (value) => ({
  bytes: Buffer.byteLength(value, 'utf8'),
  sha256: sha256(value),
});

const createNativeResult = ({
  selectedCatalog = createCatalog(),
  selectedTaskId = taskId,
  stdout = 'fixture passed\n',
} = {}) => {
  const selectedTask = taskDefinitions.get(selectedTaskId);
  assert.ok(selectedTask, `Unknown fixture task: ${selectedTaskId}`);
  const stderr = '';
  const stdoutEvidence = outputEvidence(stdout);
  const stderrEvidence = outputEvidence(stderr);
  const receipt = {
    status: 'passed',
    exitCode: 0,
    signal: null,
    aborted: false,
    timedOut: false,
    wallMs: 1,
    stdout,
    stderr,
    stdoutBytes: stdoutEvidence.bytes,
    stderrBytes: stderrEvidence.bytes,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutSha256: stdoutEvidence.sha256,
    stderrSha256: stderrEvidence.sha256,
    lifecycle: {
      spawned: true,
      completed: true,
      cleanupVerified: true,
      cleanupError: null,
    },
  };
  const core = {
    schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
    applicationId: selectedCatalog.applicationId,
    candidateSha256: selectedCatalog.candidate.candidateSha256,
    catalogSha256: selectedCatalog.catalogSha256,
    taskId: selectedTaskId,
    adapterId: selectedTask.adapterId,
    files: [...selectedTask.files],
    status: 'passed',
    wallMs: 2,
    totals: { [selectedTask.adapterId]: { total: 1, active: 1 } },
    receipt,
  };
  return { ...core, resultSha256: canonicalJsonSha256(core) };
};

const createTaskFailureError = ({
  aborted = false,
  timedOut = false,
  exitCode = aborted || timedOut ? null : 1,
  stderr = 'fixture native task failed\n',
} = {}) => {
  const stdout = '';
  const stdoutEvidence = outputEvidence(stdout);
  const stderrEvidence = outputEvidence(stderr);
  return Object.assign(new Error('fixture native task failed'), {
    receipt: {
      exitCode,
      signal: null,
      aborted,
      timedOut,
      wallMs: 1,
      stdout,
      stderr,
      stdoutBytes: stdoutEvidence.bytes,
      stderrBytes: stderrEvidence.bytes,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutSha256: stdoutEvidence.sha256,
      stderrSha256: stderrEvidence.sha256,
      lifecycle: {
        spawned: true,
        completed: true,
        cleanupVerified: true,
        cleanupError: null,
      },
    },
  });
};

const request = (value, selectedTaskId) =>
  createDistributedNativeTaskRequest(value, selectedTaskId);

const runtime = ({
  configValue = config(),
  applications = [{ id: applicationId, root }],
  allowedTaskIds = [taskId],
  catalogFactory = catalog,
  taskExecutor,
  instanceId = 'worker-session-one',
} = {}) =>
  createDistributedWorkerRuntime({
    config: configValue,
    workerId: 'worker-one',
    applications,
    allowedTaskIds,
    catalogFactory,
    taskExecutor: taskExecutor ?? (async () => createNativeResult()),
    capacityDetector: () => ({
      effectiveLogicalCpus: 8,
      configuredWorkers: 2,
      policy: 'fixture-explicit',
    }),
    instanceId,
  });

const taskBody = (runId = 'run-one') => ({
  configSha256: config().configSha256,
  runId,
  applicationId,
  expectedCandidate: candidate,
  request: request(createCatalog(), taskId),
});

const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const abortReason = (signal) => {
  if (signal.aborted) return Promise.resolve(signal.reason);
  return new Promise((resolveReason) => {
    signal.addEventListener('abort', () => resolveReason(signal.reason), {
      once: true,
    });
  });
};

// Test-only self-signed identity for a loopback worker. It protects no real
// system and is embedded so the runtime acceptance test needs no external tool.
const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDR8guGMsBNjVAY
a9IiuQuz1hmImYv7CG5hrII7JlujH+GOjwAhMLz3MVDk9tVvM6rFovKDo9cDEUvm
E9dG7Jkd4+Zh0cm99OGTyRBWof6X8fTprhhXh1Idic7AnE0dATiWc5Ltu/mRf9Fy
eZPrr7juaPRNw8TeogpLCuKEk3kB5vZtvrM3RAQP5voa2KFe1zZqPxuZ6iA6jKMb
QLWUNLBzWntlNM5uW8izfVEQgcsnv0eaq06sz6cnTUwkVkzBP10w/T7FowQjjVSH
cknUJSu/wLVzC0faWpl6PRr9yH+vufIC18aLSEXJ04/zB83/qoSi8VWhqrl8qo7z
PK5gvKIzAgMBAAECggEAWoWcHXFNhEK9ecInmUwjNRfH66OU/Ri+C0RH5Lwdv+CT
rxWOb0EmAQlVAVxCW8+xvsSK/2KJ5ysyiBIe/NgwDvjAUYYUj+CB0OhdMJVpgldT
i9xCZ58Ts2PDbz4Va7+miAxuGi42JduwUcUFGBaszLMZP1x9SqcgfAnF8Hbrsnr8
7gmdvLew7xFzH8qaRb+sam3hkjM1Q8fm5VWIblJciQpR0EtOvb0ic6q/IXxO6z7L
0w2gUENDrQ1hAxHcmGUdvmyDUiy1MPX265w9jmWDvN7Q599UFIUwQmeBUKXKwkJb
fkoqwyUgVkMKa+tFBvvRKO2PfkN8QGAJ4CYdEbnrKQKBgQDrNuY/xGdmE/4OHeRw
rEVXRBDKlayecOZdR9AS1+S1p9Z2rymTYGD83qNWlp46fw+9uWyKJoqHH1x2SVHN
EMMqD8usTvm1u2y2KC1XcIiIikXvvYbrlozvkFwJVAMk19pOij3WV1aKJIDOhb1+
gSlTdH/lIIo9hRwFgV/0SPHW6wKBgQDkf4Crq07TKmwvDJatU5OT8ejB3tuqDGO/
N5W1nxxh4T8O+XtkW0ypOc3/vyZRD3pTpXK4h9mm/0ir7IWRjpiU/rhCE5YAaWBQ
FVwxLfcT5aV7I2TAiYhAYyAKNdbq6YLvPBYvVgXSm7QA6XoLtVft25UigNr053Np
DPmqaGUf2QKBgQCl0gw8hD/IzOtcFGLJtAkmXkvgJeiNwlYFCO19e0o3bl1ZSl9r
EJUPb/2Cu6hM4Oq9/Ayy0Dz0yX0rvsC2aszLyFrz3LFaFwmq2WQtsp3udFydiOWn
DHnLIeBgiyO0Q6AZooe5pdTSiq1r6wkOOAxkU0sewvPyLvb0QqLc2tfzhQKBgQCX
ihgDwjEcyt3EtkyX1v3g+GatbOex91WP04VuVn+0SnZPsBWtkP9em/+KxXLb/6/Z
GbjjuPUYU+YWX16WEkQPTH9XEzZAP6KoegISe7GJeJwu9mIzbwL18Mem/d3zHbrA
ftEXw61I6AqRMEbIzRPro91cbKjKE1XvLbPG2EV4wQKBgFa7zUihc3qoC+VUR0bc
vH6dbrOqtRL/9N5rC1OmqXzYt3/CdN8QWvQUsXqPY314P/B3rEUDTIBLHgGh8yDV
k2LLFonUPaL3Ghs+fA5GG+NC0AwjNCD7zFK3+TSOhT9yi/PEwXD9eEI27aYJRQ5l
9TLpKPGNplHNWfcgaDxkQKty
-----END PRIVATE KEY-----`;

const certificate = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUc+3C/4S0A+z/uhFMPCyHObrZMZkwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTAwNjE4MzMwOFoXDTM2MTAw
MzE4MzMwOFowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA0fILhjLATY1QGGvSIrkLs9YZiJmL+whuYayCOyZbox/h
jo8AITC89zFQ5PbVbzOqxaLyg6PXAxFL5hPXRuyZHePmYdHJvfThk8kQVqH+l/H0
6a4YV4dSHYnOwJxNHQE4lnOS7bv5kX/RcnmT66+47mj0TcPE3qIKSwrihJN5Aeb2
bb6zN0QED+b6GtihXtc2aj8bmeogOoyjG0C1lDSwc1p7ZTTOblvIs31REIHLJ79H
mqtOrM+nJ01MJFZMwT9dMP0+xaMEI41Uh3JJ1CUrv8C1cwtH2lqZej0a/ch/r7ny
AtfGi0hFydOP8wfN/6qEovFVoaq5fKqO8zyuYLyiMwIDAQABo28wbTAdBgNVHQ4E
FgQU9uHC3u4s9lS0aMtUPPm8GQBsR/IwHwYDVR0jBBgwFoAU9uHC3u4s9lS0aMtU
PPm8GQBsR/IwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARhwR/AAABgglsb2Nh
bGhvc3QwDQYJKoZIhvcNAQELBQADggEBAIzWJwZsBK2uH0EI6jTZqxc21CR4gGi3
XHQ4/Df3OaCdCCNkBeEs4bVZJ1BY228BaSHXKtGUZfumU4kL2qBLW5dropYv/gSI
Amxjm3OMPhrwy6qnoSAlnRB+joW9LuYZzJTxG/lHsGaMBVCDJHsCPdPjZgtJm7q3
GnHSmprms40bqvh+RYdUmJ00JMs03TGZ6Sf5pXizMRHQ9jbWs7++lrAC1wgXEi0n
zoEhGUOGoT5P7Mr8HpccmhHGGFdbodBOlS1iJP6KRSAD5CCZLNRSvJj+ZIPsWx6V
tPd10ghYNUMdw5xOIFmIz6GGuODhfDT/KVHLJLTP929rc+e3DfYNjVc=
-----END CERTIFICATE-----`;

const remoteSecret = Buffer.alloc(32, 0x5a);
const remoteIdentitySha256 = distributedTrustedCertificateSha256(certificate);

const availableLoopbackPort = async () => {
  const server = createTcpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const { port } = address;
  server.close();
  await once(server, 'close');
  return port;
};

test('milestone admits one absolute application and a bounded local task set', () => {
  assert.deepEqual(parseDistributedApplicationBindings([`seerrng=${root}`]), [
    { id: applicationId, root },
  ]);
  assert.throws(
    () => parseDistributedApplicationBindings(['seerrng=relative']),
    /must be absolute/
  );
  assert.throws(
    () => parseDistributedApplicationBindings([]),
    /exactly one --app/
  );
  assert.throws(
    () =>
      parseDistributedApplicationBindings([`seerrng=${root}`, `other=${root}`]),
    /exactly one --app/
  );
  assert.throws(
    () => runtime({ applications: [] }),
    /exactly one application binding/
  );
  assert.throws(() => runtime({ allowedTaskIds: [] }), /nonempty bounded set/);
  assert.throws(
    () => runtime({ allowedTaskIds: [taskId, taskId] }),
    /unique hashed task IDs/
  );
  assert.throws(
    () =>
      runtime({
        allowedTaskIds: Array(MAX_DISTRIBUTED_NATIVE_TASKS + 1).fill(taskId),
      }),
    /nonempty bounded set/
  );
});

test('worker derives several allowed tasks locally and executes one selected task at a time', async () => {
  const allowedTaskIds = [taskId, secondTaskId];
  const selectedCatalog = createCatalog(applicationId, allowedTaskIds);
  const worker = runtime({
    allowedTaskIds,
    catalogFactory(applicationRoot, options) {
      assert.equal(applicationRoot, root);
      assert.deepEqual(options, { applicationId, allowedTaskIds });
      return selectedCatalog;
    },
    taskExecutor: async ({ request: selectedRequest }) => ({
      selectedTaskId: selectedRequest.taskId,
    }),
  });
  const report = await worker.handle({
    kind: DISTRIBUTED_PROBE_KIND,
    body: {
      configSha256: config().configSha256,
      applicationIds: [applicationId],
    },
  });
  assert.equal(report.applications[0].taskCount, 2);
  assert.equal(
    report.applications[0].catalogSha256,
    selectedCatalog.catalogSha256
  );

  for (const selectedTaskId of allowedTaskIds) {
    const result = await worker.handle({
      kind: DISTRIBUTED_TASK_KIND,
      body: {
        configSha256: config().configSha256,
        runId: `run-${selectedTaskId.slice(0, 8)}`,
        applicationId,
        expectedCandidate: candidate,
        request: request(
          createCatalog(applicationId, [selectedTaskId]),
          selectedTaskId
        ),
      },
    });
    assert.equal(result.taskId, selectedTaskId);
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.result, { selectedTaskId });
  }
});

test('worker probe reports only locally derived application and capacity data', async () => {
  const worker = runtime();
  const report = await worker.handle({
    kind: DISTRIBUTED_PROBE_KIND,
    body: {
      configSha256: config().configSha256,
      applicationIds: ['seerrng'],
    },
  });
  assert.equal(report.workerId, 'worker-one');
  assert.equal(report.instanceId, 'worker-session-one');
  assert.deepEqual(report.capacity, {
    effectiveLogicalCpus: 8,
    configuredWorkers: 2,
    policy: 'fixture-explicit',
  });
  assert.deepEqual(report.applications, [
    {
      applicationId: 'seerrng',
      candidateSha256,
      catalogSha256: createCatalog().catalogSha256,
      inventorySha256,
      taskCount: 1,
    },
  ]);
  await assert.rejects(
    worker.handle({
      kind: DISTRIBUTED_PROBE_KIND,
      body: {
        configSha256: config().configSha256,
        applicationIds: ['unknown'],
      },
    }),
    /does not register application/
  );
});

test('concurrent duplicates dedupe while a completed key can run again', async () => {
  let calls = 0;
  const started = deferred();
  const release = deferred();
  const worker = runtime({
    taskExecutor: async () => {
      calls += 1;
      if (calls === 1) {
        started.resolve();
        await release.promise;
      }
      return createNativeResult();
    },
  });
  const body = taskBody();
  const firstPromise = worker.handle({ kind: DISTRIBUTED_TASK_KIND, body });
  await started.promise;
  const duplicatePromise = worker.handle({ kind: DISTRIBUTED_TASK_KIND, body });
  release.resolve();
  const [first, duplicate] = await Promise.all([
    firstPromise,
    duplicatePromise,
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(duplicate, first);
  assert.equal(first.status, 'passed');
  assert.equal(first.taskId, taskId);
  await Promise.resolve();
  const retry = await worker.handle({ kind: DISTRIBUTED_TASK_KIND, body });
  assert.equal(calls, 2);
  assert.equal(retry.status, 'passed');
});

test('worker rejects controller source drift before task execution', async () => {
  let calls = 0;
  const worker = runtime({
    taskExecutor: async () => {
      calls += 1;
      return createNativeResult();
    },
  });
  await assert.rejects(
    worker.handle({
      kind: DISTRIBUTED_TASK_KIND,
      body: {
        ...taskBody('run-drift'),
        runId: 'run-two',
        expectedCandidate: {
          ...candidate,
          candidateSha256: sha256('another-candidate'),
        },
      },
    }),
    /candidate does not match/
  );
  assert.equal(calls, 0);
});

test('controller task path proves worker identity and uses the same local worker handler', async () => {
  const worker = runtime();
  const result = await runDistributedControllerTask({
    config: config(),
    applications: [{ id: applicationId, root }],
    workerId: 'worker-one',
    applicationId,
    taskId,
    runId: 'run-controller-one',
    localRuntime: worker,
    catalogFactory: catalog,
    requestFactory: request,
  });
  assert.equal(result.report.instanceId, 'worker-session-one');
  assert.equal(result.result.workerId, 'worker-one');
  assert.equal(result.result.taskId, taskId);
  assert.equal(result.result.status, 'passed');
  assert.deepEqual(result.result.result, createNativeResult());
});

test('controller accepts a bounded multi-task worker report while dispatching one task', async () => {
  const allowedTaskIds = [taskId, secondTaskId];
  const workerCatalog = createCatalog(applicationId, allowedTaskIds);
  const worker = runtime({
    allowedTaskIds,
    catalogFactory: (_applicationRoot, { applicationId: selectedId }) =>
      createCatalog(selectedId, allowedTaskIds),
    taskExecutor: async () =>
      createNativeResult({
        selectedCatalog: workerCatalog,
        selectedTaskId: secondTaskId,
      }),
  });
  const result = await runDistributedControllerTask({
    config: config(),
    applications: [{ id: applicationId, root }],
    workerId: 'worker-one',
    applicationId,
    taskId: secondTaskId,
    runId: 'run-controller-multi-worker-catalog',
    localRuntime: worker,
    catalogFactory(applicationRoot, options) {
      assert.equal(applicationRoot, root);
      assert.deepEqual(options, {
        applicationId,
        allowedTaskIds: [secondTaskId],
      });
      return createCatalog(applicationId, [secondTaskId]);
    },
    requestFactory: request,
  });
  assert.equal(result.report.applications[0].taskCount, 2);
  assert.equal(result.result.taskId, secondTaskId);
  assert.deepEqual(result.result.result.files, secondFiles);
  assert.equal(result.result.status, 'passed');
});

test('controller rejects malformed or tampered nested native results', async (t) => {
  const cases = [
    {
      name: 'missing nested lifecycle evidence',
      mutate(value) {
        delete value.receipt.lifecycle.cleanupVerified;
      },
      pattern: /receipt lifecycle requires its exact field set/,
    },
    {
      name: 'changed nested output without a new result seal',
      mutate(value) {
        value.receipt.stdout = 'tampered\n';
      },
      pattern: /result hash is invalid/,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const nested = structuredClone(createNativeResult());
      scenario.mutate(nested);
      await assert.rejects(
        runDistributedControllerTask({
          config: config(),
          applications: [{ id: applicationId, root }],
          workerId: 'worker-one',
          applicationId,
          taskId,
          runId: `run-${scenario.name.replaceAll(' ', '-')}`,
          localRuntime: runtime({
            taskExecutor: async () => nested,
          }),
          catalogFactory: catalog,
          requestFactory: request,
        }),
        scenario.pattern
      );
    });
  }
});

test('controller validates worker report evidence before dispatch', async (t) => {
  const cases = [
    {
      name: 'malformed catalog digest',
      mutate(report) {
        report.applications[0].catalogSha256 = 'not-a-digest';
      },
      pattern: /Exact worker application catalog hash is required/,
    },
    {
      name: 'malformed inventory digest',
      mutate(report) {
        report.applications[0].inventorySha256 = 'not-a-digest';
      },
      pattern: /Exact worker application inventory hash is required/,
    },
    {
      name: 'zero executable tasks',
      mutate(report) {
        report.applications[0].taskCount = 0;
      },
      pattern: /outside its supported range/,
    },
    {
      name: 'too many executable tasks',
      mutate(report) {
        report.applications[0].taskCount = MAX_DISTRIBUTED_NATIVE_TASKS + 1;
      },
      pattern: /outside its supported range/,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const worker = runtime();
      const interceptingRuntime = {
        workerId: worker.workerId,
        async handle(message) {
          const value = await worker.handle(message);
          if (message.kind !== DISTRIBUTED_PROBE_KIND) return value;
          const report = structuredClone(value);
          scenario.mutate(report);
          return report;
        },
      };
      await assert.rejects(
        runDistributedControllerTask({
          config: config(),
          applications: [{ id: applicationId, root }],
          workerId: 'worker-one',
          applicationId,
          taskId,
          runId: `run-${scenario.name.replaceAll(' ', '-')}`,
          localRuntime: interceptingRuntime,
          catalogFactory: catalog,
          requestFactory: request,
        }),
        scenario.pattern
      );
    });
  }
});

test('controller-local timeout aborts the task execution signal', async () => {
  const observedAbort = deferred();
  const worker = runtime({
    taskExecutor: async ({ signal }) => {
      const reason = await abortReason(signal);
      observedAbort.resolve(reason);
      throw createTaskFailureError({ aborted: true, timedOut: true });
    },
  });
  const result = await runDistributedControllerTask({
    config: config(),
    applications: [{ id: applicationId, root }],
    workerId: 'worker-one',
    applicationId,
    taskId,
    runId: 'run-local-timeout',
    timeoutMs: 25,
    localRuntime: worker,
    catalogFactory: catalog,
    requestFactory: request,
  });
  assert.equal((await observedAbort.promise).name, 'TimeoutError');
  assert.equal(result.result.status, 'failed');
  assert.equal(result.result.failure.reason, 'timed-out');
  assert.equal(result.result.failure.receipt.timedOut, true);
});

test('drain aborts and waits for in-flight work', async () => {
  const started = deferred();
  const observedAbort = deferred();
  const release = deferred();
  const worker = runtime({
    taskExecutor: async ({ signal }) => {
      started.resolve();
      const reason = await abortReason(signal);
      observedAbort.resolve(reason);
      await release.promise;
      throw createTaskFailureError({ aborted: true });
    },
  });
  const execution = worker.handle({
    kind: DISTRIBUTED_TASK_KIND,
    body: taskBody('run-drain'),
  });
  await started.promise;
  let drained = false;
  const draining = worker.drain().then(() => {
    drained = true;
  });
  assert.equal((await observedAbort.promise).name, 'AbortError');
  await Promise.resolve();
  assert.equal(drained, false);
  release.resolve();
  const result = await execution;
  assert.equal(result.status, 'failed');
  assert.equal(result.failure.reason, 'aborted');
  await draining;
  assert.equal(drained, true);
});

test('real HTTPS remote runtime authenticates pass and failure evidence', async (t) => {
  const port = await availableLoopbackPort();
  const address = `https://127.0.0.1:${port}`;
  const remoteConfig = config({
    address,
    identitySha256: remoteIdentitySha256,
    controllerWorkerId: null,
  });
  let taskExecutions = 0;
  const service = await startDistributedWorkerServer({
    config: remoteConfig,
    workerId: 'worker-one',
    applications: [{ id: applicationId, root }],
    allowedTaskIds: [taskId],
    key: privateKey,
    certificate,
    secret: remoteSecret,
    allowedSourceAddresses: ['127.0.0.1'],
    host: '127.0.0.1',
    port,
    runtimeFactory: (options) =>
      createDistributedWorkerRuntime({
        ...options,
        catalogFactory: catalog,
        taskExecutor: async () => {
          taskExecutions += 1;
          if (taskExecutions === 1) return createNativeResult();
          throw createTaskFailureError();
        },
        capacityDetector: () => ({
          effectiveLogicalCpus: 8,
          configuredWorkers: 2,
          policy: 'fixture-explicit',
        }),
        instanceId: 'remote-worker-session',
      }),
  });
  t.after(() => service.close());
  assert.equal(service.server.origin, address);

  const result = await runDistributedControllerTask({
    config: remoteConfig,
    applications: [{ id: applicationId, root }],
    workerId: 'worker-one',
    applicationId,
    taskId,
    runId: 'run-remote-https',
    secret: remoteSecret,
    timeoutMs: 5_000,
    catalogFactory: catalog,
    requestFactory: request,
  });
  assert.equal(result.report.instanceId, 'remote-worker-session');
  assert.equal(result.result.status, 'passed');
  assert.deepEqual(result.result.result, createNativeResult());

  const failed = await runDistributedControllerTask({
    config: remoteConfig,
    applications: [{ id: applicationId, root }],
    workerId: 'worker-one',
    applicationId,
    taskId,
    runId: 'run-remote-https-failure',
    secret: remoteSecret,
    timeoutMs: 5_000,
    catalogFactory: catalog,
    requestFactory: request,
  });
  assert.equal(taskExecutions, 2);
  assert.equal(failed.result.status, 'failed');
  assert.equal('result' in failed.result, false);
  assert.equal(failed.result.failure.reason, 'native-failed');
  assert.equal(
    failed.result.failure.receipt.stderrTail,
    'fixture native task failed\n'
  );
  assert.match(failed.result.failure.failureSha256, /^[a-f0-9]{64}$/);
});
