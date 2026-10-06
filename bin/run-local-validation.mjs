#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { createNativeStageContext } from '../tools/validation-engine/runtime/native-stage-context.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { executeStagedValidation } from '../tools/validation-engine/runtime/staged-validation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  createHostedGithubPlan,
  githubChangedFilesRange,
} from '../tools/validation-engine/runtime/hosted-github-plan.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { createHostedTestInventory } from '../tools/validation-engine/runtime/hosted-test-inventory.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  admitHostedGithubUnit,
  executeHostedTestLane,
  loadHostedReceiptDirectory,
  materializeHostedVitestLane,
  readHostedGithubPlan,
  reconcileHostedGithubExecution,
  sealHostedGithubUnitReceipt,
  verifyHostedGithubPlanContext,
} from '../tools/validation-engine/runtime/hosted-github-execution.mjs';
import {
  createPlan,
  executePlan,
  preflight,
  printPlan,
} from './local-validation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  createDistributedControllerFailureReport,
  createDistributedScheduleFailureReport,
  createDistributedWorkerRuntime,
  encodeBoundedDistributedReport,
  parseDistributedApplicationBindings,
  runDistributedControllerSchedule,
  runDistributedControllerTask,
  startDistributedWorkerServer,
} from '../tools/validation-engine/runtime/distributed-runtime.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  configuredDistributedWorker,
  parseDistributedWorkerConfig,
} from '../tools/validation-engine/runtime/distributed-worker-config.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  createDistributedTaskManifest,
  readDistributedTaskManifest,
  verifyDistributedTaskManifestCatalog,
} from '../tools/validation-engine/runtime/distributed-task-manifest.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { discoverDistributedNativeCatalog } from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, parameters, encoding = 'utf8') =>
  execFileSync('git', ['-C', root, ...parameters], {
    ...(encoding === null ? {} : { encoding }),
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
const nulPaths = (bytes) => bytes.toString('utf8').split('\0').filter(Boolean);

function hostedGithubInput(root) {
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Hosted GitHub mode requires GitHub Actions');
  for (const name of [
    'GITHUB_EVENT_NAME',
    'GITHUB_EVENT_PATH',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_RUN_ID',
    'GITHUB_SHA',
  ])
    if (!process.env[name]?.trim())
      throw new Error(`Hosted GitHub mode requires ${name}`);
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=no']).trim())
    throw new Error('Hosted GitHub planning requires a clean tracked checkout');
  const payload = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
  );
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!['pull_request', 'push'].includes(eventName))
    throw new Error(
      'Hosted CI orchestration supports pull_request and push only'
    );
  const executionSha = git(root, ['rev-parse', 'HEAD']).trim();
  if (executionSha !== process.env.GITHUB_SHA)
    throw new Error('Checked GitHub execution SHA does not match GITHUB_SHA');
  const pullRequest = payload.pull_request;
  const headSha =
    eventName === 'pull_request' ? pullRequest?.head?.sha : payload.after;
  const baseSha =
    eventName === 'pull_request' ? pullRequest?.base?.sha : payload.before;
  if (!/^[a-f0-9]{40}$/.test(headSha ?? ''))
    throw new Error('Exact GitHub head SHA is missing');
  if (!/^[a-f0-9]{40}$/.test(baseSha ?? ''))
    throw new Error('Exact GitHub base SHA is missing');
  let changedFiles;
  let pathFilterMode = 'changed-files';
  if (eventName === 'push' && /^0{40}$/.test(baseSha ?? '')) {
    pathFilterMode = 'run-all-new-branch';
    changedFiles = [];
  } else {
    const count = git(root, [
      'rev-list',
      '--count',
      `${baseSha}..${headSha}`,
    ]).trim();
    if (!/^\d+$/.test(count))
      throw new Error('Exact GitHub change commit count is unavailable');
    if (BigInt(count) > 1000n) {
      pathFilterMode = 'run-all-large-update';
      changedFiles = [];
    }
  }
  if (!changedFiles) {
    changedFiles = nulPaths(
      git(
        root,
        [
          'diff',
          '--name-only',
          '--diff-filter=ACDMRTUXB',
          '-z',
          githubChangedFilesRange(eventName, baseSha, headSha),
          '--',
        ],
        null
      )
    );
  }
  const workflowFiles = {
    ci: '.github/workflows/ci.yml',
    codeql: '.github/workflows/codeql.yml',
    cypress: '.github/workflows/cypress.yml',
    testDocs: '.github/workflows/test-docs.yml',
    docsLinks: '.github/workflows/docs-link-check.yml',
    helm: '.github/workflows/lint-helm-charts.yml',
  };
  const workflowHashes = Object.fromEntries(
    Object.entries(workflowFiles).map(([name, file]) => [
      name,
      hash(readFileSync(resolve(root, file))),
    ])
  );
  return {
    candidate: {
      repository: process.env.GITHUB_REPOSITORY,
      commit: executionSha,
      tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(),
      lockSha256: hash(readFileSync(resolve(root, 'pnpm-lock.yaml'))),
      sourceSha256: hash(
        git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], null)
      ),
    },
    event: {
      name: eventName,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      executionSha,
      headSha,
      baseSha,
      ref: process.env.GITHUB_REF ?? null,
      baseRef:
        eventName === 'pull_request'
          ? (pullRequest?.base?.ref ?? process.env.GITHUB_BASE_REF ?? null)
          : null,
      actorType:
        eventName === 'pull_request' ? (pullRequest?.user?.type ?? null) : null,
      pathFilterMode,
    },
    changedFiles,
    workflowHashes,
    testInventory: createHostedTestInventory(root),
  };
}

function writeHostedPlanOutputs(plan, planFile) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('Hosted GitHub planning requires GITHUB_OUTPUT');
  if (!planFile) throw new Error('Hosted GitHub planning requires --plan-file');
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  const byWorkflow = Object.fromEntries(
    plan.units.map((unit) => [unit.workflow, unit.applicable])
  );
  const unit = plan.units.find((entry) => entry.id === 'ci-unit-test');
  const cypress = plan.units.find((entry) => entry.id === 'cypress-run');
  if (!unit || !cypress)
    throw new Error('Hosted plan is missing its sharded test units');
  const unitMatrix = {
    include: unit.caseAssignments.map((assignment) => ({
      case_id: assignment.caseId,
    })),
  };
  const cypressMatrix = {
    include: cypress.caseAssignments.map((assignment) => {
      const lane = assignment.lanes.find((entry) => entry.id === 'cypress');
      if (
        !lane ||
        !lane.files.length ||
        lane.files.some(
          (file) =>
            file.includes(',') || file.includes('\r') || file.includes('\n')
        )
      )
        throw new Error('Hosted Cypress matrix contains unsafe specs');
      return { case_id: assignment.caseId, specs: lane.files.join(',') };
    }),
  };
  const values = {
    planSha256: plan.planSha256,
    runId: plan.event.runId,
    runAttempt: plan.event.runAttempt,
    executionSha: plan.event.executionSha,
    headSha: plan.event.headSha,
    codeql: byWorkflow.codeql,
    cypress: byWorkflow.cypress,
    testDocs: byWorkflow.testDocs,
    docsLinks: byWorkflow.docsLinks,
    helm: byWorkflow.helm,
    unitMatrix: JSON.stringify(unitMatrix),
    cypressMatrix: JSON.stringify(cypressMatrix),
  };
  appendFileSync(
    output,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
}

function writeHostedAdmissionOutputs(decision) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output)
    throw new Error('Hosted GitHub admission requires GITHUB_OUTPUT');
  appendFileSync(
    output,
    `${[
      ['action', decision.action],
      ['execute', 'true'],
      ['decisionSha256', decision.decisionSha256],
    ]
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
}

const flagOptions = new Set([
  '--help',
  '-h',
  '--plan',
  '--json',
  '--tests-only',
  '--github-plan',
  '--github-admit',
  '--github-materialize-test-lane',
  '--github-receipt',
  '--github-run-test-lane',
  '--github-reconcile',
  '--distributed-discover',
  '--distributed-controller',
  '--distributed-schedule',
  '--distributed-worker',
]);
const valueOptions = new Set([
  '--application',
  '--allow-task-file',
  '--case',
  '--distributed-config',
  '--expected-plan-sha256',
  '--job-status',
  '--lane',
  '--listen-host',
  '--output-file',
  '--plan-file',
  '--receipt-dir',
  '--report-file',
  '--task-file',
  '--timeout-ms',
  '--tls-cert',
  '--tls-key',
  '--unit',
  '--worker-id',
]);
const repeatedValueOptions = new Set([
  '--allow-controller',
  '--allow-task',
  '--app',
  '--evidence',
  '--task',
]);

const optionContracts = {
  'local-full': {
    label: 'Local full mode',
    allowed: new Set(),
    requiredValues: [],
  },
  'local-tests-only': {
    label: 'Local tests-only mode',
    allowed: new Set(['--tests-only']),
    requiredValues: [],
  },
  'local-plan': {
    label: 'Local plan mode',
    allowed: new Set(['--plan', '--tests-only', '--json']),
    requiredValues: [],
  },
  'github-plan': {
    label: 'GitHub plan mode',
    allowed: new Set(['--github-plan', '--plan-file', '--json']),
    requiredValues: ['--plan-file'],
  },
  'github-admit': {
    label: 'GitHub admission mode',
    allowed: new Set([
      '--github-admit',
      '--unit',
      '--case',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
    ],
  },
  'github-run-test-lane': {
    label: 'GitHub test-lane mode',
    allowed: new Set([
      '--github-run-test-lane',
      '--unit',
      '--case',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--report-file',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--report-file',
    ],
  },
  'github-materialize-test-lane': {
    label: 'GitHub test-lane materialization mode',
    allowed: new Set([
      '--github-materialize-test-lane',
      '--unit',
      '--case',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--output-file',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--case',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--output-file',
    ],
  },
  'github-receipt': {
    label: 'GitHub receipt mode',
    allowed: new Set([
      '--github-receipt',
      '--unit',
      '--case',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--job-status',
      '--evidence',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--job-status',
    ],
  },
  'github-reconcile': {
    label: 'GitHub reconciliation mode',
    allowed: new Set([
      '--github-reconcile',
      '--plan-file',
      '--receipt-dir',
      '--json',
    ]),
    requiredValues: ['--plan-file', '--receipt-dir'],
  },
  'distributed-controller': {
    label: 'Distributed controller mode',
    allowed: new Set([
      '--distributed-controller',
      '--distributed-config',
      '--worker-id',
      '--application',
      '--task',
      '--timeout-ms',
      '--app',
      '--report-file',
    ]),
    requiredValues: [
      '--distributed-config',
      '--worker-id',
      '--application',
      '--report-file',
    ],
    requiredRepeated: ['--app', '--task'],
  },
  'distributed-schedule': {
    label: 'Distributed schedule mode',
    allowed: new Set([
      '--distributed-schedule',
      '--distributed-config',
      '--application',
      '--task',
      '--task-file',
      '--timeout-ms',
      '--app',
      '--report-file',
    ]),
    requiredValues: ['--distributed-config', '--application', '--report-file'],
    requiredRepeated: ['--app'],
  },
  'distributed-discover': {
    label: 'Distributed discovery mode',
    allowed: new Set([
      '--distributed-discover',
      '--application',
      '--app',
      '--task-file',
      '--json',
    ]),
    requiredValues: ['--application'],
    requiredRepeated: ['--app'],
  },
  'distributed-worker': {
    label: 'Distributed worker mode',
    allowed: new Set([
      '--distributed-worker',
      '--distributed-config',
      '--worker-id',
      '--app',
      '--tls-cert',
      '--tls-key',
      '--listen-host',
      '--allow-controller',
      '--allow-task',
      '--allow-task-file',
    ]),
    requiredValues: [
      '--distributed-config',
      '--worker-id',
      '--tls-cert',
      '--tls-key',
      '--listen-host',
    ],
    requiredRepeated: ['--app', '--allow-controller'],
  },
};

function parseOptions(args) {
  const flags = new Set();
  const values = new Map();
  const repeated = new Map();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (flagOptions.has(option)) {
      if (flags.has(option)) throw new Error(`Duplicate option: ${option}`);
      flags.add(option);
      continue;
    }
    if (valueOptions.has(option) || repeatedValueOptions.has(option)) {
      const value = args[++index];
      if (!value || value.startsWith('-'))
        throw new Error(`Missing value for ${option}`);
      if (repeatedValueOptions.has(option)) {
        const entries = repeated.get(option) ?? [];
        if (entries.includes(value))
          throw new Error(`Duplicate value for ${option}: ${value}`);
        entries.push(value);
        repeated.set(option, entries);
      } else {
        if (values.has(option)) throw new Error(`Duplicate option: ${option}`);
        values.set(option, value);
      }
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  return { flags, values, repeated };
}

function validateOptions(options) {
  const helpAliases = ['--help', '-h'].filter((option) =>
    options.flags.has(option)
  );
  if (helpAliases.length > 1) throw new Error('Duplicate option: --help');

  const names = new Set([
    ...options.flags,
    ...options.values.keys(),
    ...options.repeated.keys(),
  ]);
  if (helpAliases.length) {
    if (names.size !== 1)
      throw new Error('Help mode cannot be combined with other options');
    return { name: 'help', hostedOption: null };
  }

  const hostedModes = [
    '--github-plan',
    '--github-admit',
    '--github-materialize-test-lane',
    '--github-run-test-lane',
    '--github-receipt',
    '--github-reconcile',
  ].filter((option) => options.flags.has(option));
  if (hostedModes.length > 1)
    throw new Error('Choose exactly one hosted GitHub mode');

  const distributedModes = [
    '--distributed-discover',
    '--distributed-controller',
    '--distributed-schedule',
    '--distributed-worker',
  ].filter((option) => options.flags.has(option));
  if (distributedModes.length > 1)
    throw new Error('Choose exactly one distributed mode');
  if (hostedModes.length && distributedModes.length)
    throw new Error('Hosted GitHub and distributed modes cannot be combined');

  const hostedOption = hostedModes[0] ?? null;
  const distributedOption = distributedModes[0] ?? null;
  const name = hostedOption
    ? hostedOption.slice(2)
    : distributedOption
      ? distributedOption.slice(2)
      : options.flags.has('--plan')
        ? 'local-plan'
        : options.flags.has('--tests-only')
          ? 'local-tests-only'
          : 'local-full';
  const contract = optionContracts[name];
  for (const option of names)
    if (!contract.allowed.has(option))
      throw new Error(`${contract.label} does not accept ${option}`);
  for (const option of contract.requiredValues)
    if (!options.values.has(option))
      throw new Error(`${contract.label} requires ${option}`);
  for (const option of contract.requiredRepeated ?? [])
    if (!options.repeated.has(option))
      throw new Error(`${contract.label} requires ${option}`);
  const taskIds = options.repeated.get('--task') ?? [];
  if (name === 'distributed-controller' && taskIds.length !== 1)
    throw new Error('Distributed controller mode requires exactly one --task');
  if (name === 'distributed-schedule') {
    const hasTaskFile = options.values.has('--task-file');
    if (hasTaskFile === taskIds.length > 0)
      throw new Error(
        'Distributed schedule mode requires exactly one of --task or --task-file'
      );
    if (!hasTaskFile && taskIds.length < 2)
      throw new Error(
        'Distributed schedule mode requires at least two --task values'
      );
  }
  if (name === 'distributed-worker') {
    const allowedTaskIds = options.repeated.get('--allow-task') ?? [];
    const hasTaskFile = options.values.has('--allow-task-file');
    if (hasTaskFile === allowedTaskIds.length > 0)
      throw new Error(
        'Distributed worker mode requires exactly one of --allow-task or --allow-task-file'
      );
  }
  return { name, hostedOption, distributedOption };
}

let options;
let selectedMode;
try {
  options = parseOptions(process.argv.slice(2));
  selectedMode = validateOptions(options);
} catch (error) {
  options = undefined;
  selectedMode = undefined;
  process.stderr.write(`${error.message}. Use --help.\n`);
  process.exitCode = 1;
}
const has = (option) => options?.flags.has(option) ?? false;
const value = (option) => options?.values.get(option);
const repeated = (option) => options?.repeated.get(option) ?? [];
const requiredValue = (option) => {
  const result = value(option);
  if (!result) throw new Error(`Selected mode requires ${option}`);
  return result;
};

function distributedFleetSecret() {
  const encoded = process.env.SEERRNG_DISTRIBUTED_SHARED_SECRET;
  if (
    typeof encoded !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded
    )
  )
    throw new Error(
      'Distributed mode requires canonical base64 SEERRNG_DISTRIBUTED_SHARED_SECRET'
    );
  const secret = Buffer.from(encoded, 'base64');
  if (secret.length < 32 || secret.toString('base64') !== encoded) {
    secret.fill(0);
    throw new Error('Distributed fleet secret must contain at least 32 bytes');
  }
  delete process.env.SEERRNG_DISTRIBUTED_SHARED_SECRET;
  return secret;
}

function positiveMilliseconds(option, fallback) {
  const raw = value(option);
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d{0,8}$/.test(raw))
    throw new Error(`${option} must be a positive integer`);
  return Number(raw);
}

function taskSelection(
  option,
  fileOption,
  minimum,
  { applications, applicationId = null } = {}
) {
  const manifestFile = value(fileOption);
  if (!manifestFile)
    return { taskIds: repeated(option), selectionManifestSha256: null };
  const manifest = readDistributedTaskManifest(manifestFile, { minimum });
  if (applicationId && manifest.applicationId !== applicationId)
    throw new Error(
      'Distributed task manifest does not match the selected application'
    );
  const application = applications?.find(
    ({ id }) => id === manifest.applicationId
  );
  if (!application)
    throw new Error(
      'Distributed task manifest application is not registered locally'
    );
  const catalog = discoverDistributedNativeCatalog(application.root, {
    applicationId: manifest.applicationId,
  });
  verifyDistributedTaskManifestCatalog(manifest, catalog, { minimum });
  return {
    taskIds: manifest.taskIds,
    selectionManifestSha256: manifest.manifestSha256,
  };
}

const MAX_DISTRIBUTED_REPORT_BYTES = 32 * 1024 * 1024;

function distributedOutputFile(sourceRoot, outputFile, kind = 'report') {
  const label = `Distributed ${kind} file`;
  if (!isAbsolute(outputFile))
    throw new Error(
      `${label} must be absolute and outside the source checkout`
    );
  const realSourceRoot = realpathSync(sourceRoot);
  const lexicalRelation = relative(realSourceRoot, resolve(outputFile));
  const lexicallyOutsideSource =
    isAbsolute(lexicalRelation) ||
    lexicalRelation === '..' ||
    lexicalRelation.startsWith(`..${sep}`);
  if (!lexicallyOutsideSource)
    throw new Error(
      `${label} must be absolute and outside the source checkout`
    );
  let realParent;
  try {
    realParent = realpathSync(dirname(outputFile));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      throw new Error(`${label} requires an existing parent directory`, {
        cause: error,
      });
    throw error;
  }
  const relation = relative(realSourceRoot, realParent);
  const outsideSource =
    isAbsolute(relation) ||
    relation === '..' ||
    relation.startsWith(`..${sep}`);
  if (!outsideSource)
    throw new Error(
      `${label} must be absolute and outside the source checkout`
    );
  const admitted = join(realParent, basename(outputFile));
  try {
    const existing = lstatSync(admitted);
    throw new Error(
      existing.isSymbolicLink()
        ? `${label} must not be an existing symlink or reparse point`
        : `${label} must not already exist`
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return admitted;
}

function writeDistributedReport(reportFile, encoded) {
  if (typeof encoded !== 'string')
    throw new Error('Distributed report encoding must be text');
  if (Buffer.byteLength(encoded) > MAX_DISTRIBUTED_REPORT_BYTES)
    throw new Error('Distributed report exceeds the bounded output size');
  writeFileSync(reportFile, encoded, { flag: 'wx', mode: 0o600 });
}

function writeDistributedControllerReport(reportFile, report) {
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  writeDistributedReport(reportFile, encoded);
}

if (!options) {
  // The parse error above is the complete fail-closed result.
} else if (selectedMode.name === 'help') {
  process.stdout
    .write(`Usage: node bin/run-local-validation.mjs [--tests-only] [--plan [--json]]
       node bin/run-local-validation.mjs --github-plan --plan-file FILE [--json]
       node bin/run-local-validation.mjs --github-admit --unit ID [--case ID] --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR [--json]
       node bin/run-local-validation.mjs --github-materialize-test-lane --unit ID --case ID --lane vitest --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR --output-file FILE [--json]
       node bin/run-local-validation.mjs --github-run-test-lane --unit ID [--case ID] --lane ID --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR --report-file FILE [--json]
       node bin/run-local-validation.mjs --github-receipt --unit ID [--case ID] --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR --job-status STATUS [--evidence FILE ...] [--json]
       node bin/run-local-validation.mjs --github-reconcile --plan-file FILE --receipt-dir DIR [--json]
       node bin/run-local-validation.mjs --distributed-discover --app ID=ABSOLUTE_ROOT --application ID [--task-file ABSOLUTE_FILE] [--json]
       node bin/run-local-validation.mjs --distributed-controller --distributed-config FILE --worker-id ID --app ID=ABSOLUTE_ROOT --application ID --task ID --report-file ABSOLUTE_FILE [--timeout-ms MS]
       node bin/run-local-validation.mjs --distributed-schedule --distributed-config FILE --app ID=ABSOLUTE_ROOT --application ID (--task ID --task ID [--task ID ...] | --task-file ABSOLUTE_FILE) --report-file ABSOLUTE_FILE [--timeout-ms MS]
       node bin/run-local-validation.mjs --distributed-worker --distributed-config FILE --worker-id ID --app ID=ABSOLUTE_ROOT (--allow-task ID [--allow-task ID ...] | --allow-task-file ABSOLUTE_FILE) --tls-cert FILE --tls-key FILE --listen-host ADDRESS --allow-controller ADDRESS

Runs the existing engine's staged native PR-parity gate: repository checks,
CodeQL, production builds, browser tests and applicable supplemental checks.
--tests-only  Run all discovered test suites once, preserving their native runner.
--plan        Print files, framework ownership, platform exclusions, and commands;
              do not create files or launch children.
--github-plan Create the current-run GitHub plan and native-job selections.
--github-admit
              Bind one native job/case to the immutable current-attempt plan.
--github-materialize-test-lane
              Bind one planned Vitest shard into a runner-temp native config.
--github-run-test-lane
              Run an engine-assigned native test lane with its sealed worker budget.
--github-receipt
              Seal one native job/case result and its current-attempt ledger entry.
--github-reconcile
              Verify native needs and complete sealed receipts against the plan.
--distributed-discover
              Read the clean local tests-only plan and list its native task IDs.
--distributed-controller
              Probe one configured trusted worker and run one locally derived task.
--distributed-schedule
              Run explicit locally derived tasks across every enabled configured worker.
--distributed-worker
              Serve locally derived native tasks for an authenticated controller.
--app         Register the one distributed application as ID=ABSOLUTE_ROOT.
--allow-task  Locally allow a discovered task on a distributed worker; repeatable.
--allow-task-file
              Read the worker task allowlist from one sealed absolute manifest.
--task        Select a discovered task; once for a controller, repeat for a schedule.
--task-file   Write discovery IDs to, or read a schedule selection from, one sealed absolute manifest.
--json        Machine-readable local plan, distributed catalog, hosted plan, or hosted result.
--help        Show help without reading the project or creating files.

Distributed secrets are accepted only through SEERRNG_DISTRIBUTED_SHARED_SECRET.
Does not install dependencies, synchronize source, apply live migrations, or edit GitHub workflows.
Native, Vitest-only, tooling and CI commands retain their existing behavior.
Builds and fixture migrations use an owned disposable source/configuration copy.
Missing native tools, unproven isolation and pending GitHub checks are incomplete;
failures, partial output closure and zero active tests fail closed.\n`);
} else {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  let context;
  let failure;
  try {
    const hostedMode = selectedMode.hostedOption;
    const distributedMode = selectedMode.distributedOption;
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    if (distributedMode === '--distributed-discover') {
      const applications = parseDistributedApplicationBindings(
        repeated('--app')
      );
      const applicationId = requiredValue('--application');
      const application = applications.find(({ id }) => id === applicationId);
      if (!application)
        throw new Error(
          `Distributed discovery does not register application: ${applicationId}`
        );
      const taskFile = value('--task-file')
        ? distributedOutputFile(
            root,
            requiredValue('--task-file'),
            'task manifest'
          )
        : null;
      const catalog = discoverDistributedNativeCatalog(application.root, {
        applicationId,
      });
      if (taskFile) {
        const manifest = createDistributedTaskManifest(catalog);
        writeDistributedReport(taskFile, `${JSON.stringify(manifest)}\n`);
      }
      if (has('--json'))
        process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
      else {
        process.stdout.write(
          `Distributed discovery ${catalog.catalogSha256}: ${catalog.tasks.length} locally derived tasks for ${applicationId} (${catalog.platform}).\n`
        );
        for (const task of catalog.tasks)
          process.stdout.write(
            `${task.taskId} ${task.adapterId} ${task.files.join(',')}\n`
          );
      }
    } else if (distributedMode) {
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      const config = parseDistributedWorkerConfig(
        readFileSync(resolve(requiredValue('--distributed-config')), 'utf8')
      );
      const applications = parseDistributedApplicationBindings(
        repeated('--app')
      );
      if (distributedMode === '--distributed-worker') {
        const workerId = requiredValue('--worker-id');
        const worker = configuredDistributedWorker(config, workerId);
        const address = new URL(worker.address);
        const { taskIds: allowedTaskIds } = taskSelection(
          '--allow-task',
          '--allow-task-file',
          1,
          { applications }
        );
        const secret = distributedFleetSecret();
        let service;
        try {
          service = await startDistributedWorkerServer({
            config,
            workerId,
            applications,
            allowedTaskIds,
            key: readFileSync(resolve(requiredValue('--tls-key'))),
            certificate: readFileSync(resolve(requiredValue('--tls-cert'))),
            secret,
            allowedSourceAddresses: repeated('--allow-controller'),
            host: requiredValue('--listen-host'),
            port: Number(address.port || 443),
          });
          secret.fill(0);
          const report = service.runtime.report(
            applications.map(({ id }) => id)
          );
          process.stdout.write(
            `Distributed worker ${worker.id} ready with ${report.capacity.configuredWorkers} slots for ${report.applications.length} application(s).\n`
          );
          if (!controller.signal.aborted)
            await new Promise((resolveStop) =>
              controller.signal.addEventListener('abort', resolveStop, {
                once: true,
              })
            );
        } finally {
          secret.fill(0);
          await service?.close();
        }
      } else if (distributedMode === '--distributed-controller') {
        const workerId = requiredValue('--worker-id');
        const worker = configuredDistributedWorker(config, workerId);
        const reportFile = distributedOutputFile(
          root,
          requiredValue('--report-file')
        );
        const taskId = repeated('--task')[0];
        const localRuntime =
          config.controllerWorkerId === worker.id
            ? createDistributedWorkerRuntime({
                config,
                workerId,
                applications,
                allowedTaskIds: [taskId],
              })
            : null;
        const applicationId = requiredValue('--application');
        const runId = randomUUID();
        const startedAt = new Date().toISOString();
        const started = performance.now();
        const secret = localRuntime ? undefined : distributedFleetSecret();
        let result;
        let controllerError;
        try {
          result = await runDistributedControllerTask({
            config,
            applications,
            workerId,
            applicationId,
            taskId,
            runId,
            secret,
            timeoutMs: positiveMilliseconds('--timeout-ms', 30 * 60 * 1000),
            localRuntime,
            signal: controller.signal,
          });
        } catch (error) {
          controllerError = error;
        } finally {
          secret?.fill(0);
          try {
            await localRuntime?.drain();
          } catch (error) {
            controllerError ??= error;
          }
        }
        if (controllerError)
          result = createDistributedControllerFailureReport({
            configSha256: config.configSha256,
            controllerId: config.controllerId,
            workerId: worker.id,
            runId,
            applicationId,
            taskId,
            startedAt,
            wallMs: performance.now() - started,
            error: controllerError,
            controllerAborted: controller.signal.aborted,
          });
        writeDistributedControllerReport(reportFile, result);
        if (result.controllerFailure) {
          process.stderr.write(
            `Distributed controller failed closed (${result.controllerFailure.errorCode}); remote outcome is unknown. Evidence: ${reportFile}\n`
          );
          process.exitCode = controller.signal.aborted ? 130 : 1;
        } else if (result.result.status === 'failed') {
          process.stderr.write(
            `Distributed task ${result.result.taskId} failed on ${result.result.workerId} (${result.result.failure.reason}). Evidence: ${reportFile}\n`
          );
          process.exitCode = 1;
        } else
          process.stdout.write(
            `Distributed task ${result.result.taskId} passed on ${result.result.workerId} in ${Math.round(result.result.wallMs)} ms. Evidence: ${reportFile}\n`
          );
      } else {
        const workers = config.workers.filter(({ enabled }) => enabled);
        if (workers.length < 2)
          throw new Error(
            'Distributed schedule mode requires at least two enabled configured workers'
          );
        const workerIds = workers.map(({ id }) => id);
        const applicationId = requiredValue('--application');
        const { taskIds: selectedTaskIds, selectionManifestSha256 } =
          taskSelection('--task', '--task-file', 2, {
            applications,
            applicationId,
          });
        const reportFile = distributedOutputFile(
          root,
          requiredValue('--report-file')
        );
        const localRuntimes = new Map();
        const remote = workerIds.some(
          (workerId) => workerId !== config.controllerWorkerId
        );
        let secret;
        let result;
        let scheduleError;
        const scheduleRunId = randomUUID();
        const scheduleStartedAt = new Date().toISOString();
        const scheduleStarted = performance.now();
        try {
          secret = remote ? distributedFleetSecret() : undefined;
          if (
            config.controllerWorkerId &&
            workerIds.includes(config.controllerWorkerId)
          )
            localRuntimes.set(
              config.controllerWorkerId,
              createDistributedWorkerRuntime({
                config,
                workerId: config.controllerWorkerId,
                applications,
                allowedTaskIds: selectedTaskIds,
              })
            );
          result = await runDistributedControllerSchedule({
            config,
            applications,
            workerIds,
            applicationId,
            taskIds: selectedTaskIds,
            selectionManifestSha256,
            runId: scheduleRunId,
            secret,
            timeoutMs: positiveMilliseconds('--timeout-ms', 30 * 60 * 1000),
            localRuntimes,
            signal: controller.signal,
          });
        } catch (error) {
          scheduleError = error;
        } finally {
          secret?.fill(0);
          for (const runtime of localRuntimes.values())
            try {
              await runtime.drain();
            } catch (error) {
              scheduleError ??= error;
            }
        }
        if (scheduleError) {
          const failureReport = createDistributedScheduleFailureReport({
            configSha256: config.configSha256,
            controllerId: config.controllerId,
            enabledWorkerIds: workerIds,
            runId: scheduleRunId,
            applicationId,
            taskIds: selectedTaskIds,
            selectionManifestSha256,
            startedAt: scheduleStartedAt,
            wallMs: performance.now() - scheduleStarted,
            error: scheduleError,
            controllerAborted: controller.signal.aborted,
          });
          writeDistributedReport(
            reportFile,
            encodeBoundedDistributedReport(failureReport)
          );
          process.stderr.write(
            `Distributed schedule failed before a complete result (${failureReport.errorCode}); task execution outcome is ${failureReport.taskExecutionOutcome}. Evidence: ${reportFile}\n`
          );
          process.exitCode = controller.signal.aborted ? 130 : 1;
        } else {
          writeDistributedReport(
            reportFile,
            encodeBoundedDistributedReport(result)
          );
          const passed = result.outcomes.filter(
            ({ status }) => status === 'passed'
          ).length;
          if (result.status !== 'passed') {
            process.stderr.write(
              `Distributed schedule failed (${passed}/${result.outcomes.length} tasks passed). Evidence: ${reportFile}\n`
            );
            process.exitCode = controller.signal.aborted ? 130 : 1;
          } else
            process.stdout.write(
              `Distributed schedule passed ${result.outcomes.length} tasks across ${result.workerReports.length} workers. Evidence: ${reportFile}\n`
            );
        }
      }
    } else if (hostedMode) {
      if (hostedMode === '--github-plan') {
        const plan = createHostedGithubPlan(hostedGithubInput(root));
        writeHostedPlanOutputs(plan, requiredValue('--plan-file'));
        const applicableUnits = plan.units.filter((unit) => unit.applicable);
        const applicableCases = applicableUnits.reduce(
          (total, unit) => total + unit.cases.length,
          0
        );
        process.stdout.write(
          has('--json')
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `Hosted GitHub plan ${plan.planSha256}: ${applicableUnits.length}/${plan.units.length} logical units selected across ${applicableCases} runner cases.\n`
        );
      } else {
        const planFile = requiredValue('--plan-file');
        const plan = readHostedGithubPlan(planFile);
        if (hostedMode === '--github-admit') {
          const result = admitHostedGithubUnit({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            receiptDir: requiredValue('--receipt-dir'),
          });
          writeHostedAdmissionOutputs(result.decision);
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(
                  {
                    admission: result.admission,
                    decision: result.decision,
                  },
                  null,
                  2
                )}\n`
              : `Admitted ${result.admission.unitId}/${result.admission.caseId} for hosted plan ${plan.planSha256}: ${result.decision.action}.\n`
          );
        } else if (hostedMode === '--github-materialize-test-lane') {
          if (requiredValue('--lane') !== 'vitest')
            throw new Error('Hosted materialization supports Vitest only');
          const result = materializeHostedVitestLane({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: requiredValue('--case'),
            receiptDir: requiredValue('--receipt-dir'),
            outputFile: requiredValue('--output-file'),
          });
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Materialized ${result.unitId}/${result.caseId} ${result.laneId} shard with ${result.files.length} files and ${result.configuredWorkers} workers.\n`
          );
        } else if (hostedMode === '--github-run-test-lane') {
          const result = await executeHostedTestLane({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            laneId: requiredValue('--lane'),
            receiptDir: requiredValue('--receipt-dir'),
            reportFile: requiredValue('--report-file'),
          });
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Hosted ${result.laneId} passed: ${result.counts.active}/${result.counts.total} active tests.\n`
          );
        } else if (hostedMode === '--github-receipt') {
          const result = sealHostedGithubUnitReceipt({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            receiptDir: requiredValue('--receipt-dir'),
            jobStatus: requiredValue('--job-status'),
            evidenceFiles: repeated('--evidence'),
          });
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result.receipt, null, 2)}\n`
              : `Sealed ${result.receipt.unitId}/${result.receipt.caseId}: ${result.receipt.jobStatus}.\n`
          );
        } else {
          verifyHostedGithubPlanContext(root, plan);
          const expectedPlan = process.env.SEERRNG_ENGINE_EXPECTED_PLAN_SHA256;
          if (expectedPlan !== plan.planSha256)
            throw new Error(
              'Hosted GitHub plan artifact does not match engine-plan output'
            );
          let needs;
          try {
            needs = JSON.parse(process.env.SEERRNG_ENGINE_NEEDS_JSON ?? '');
          } catch {
            throw new Error(
              'Hosted GitHub reconciliation requires valid needs JSON'
            );
          }
          const evidence = loadHostedReceiptDirectory(
            requiredValue('--receipt-dir')
          );
          const result = reconcileHostedGithubExecution(plan, needs, evidence);
          const externalSummary = result.complete
            ? ''
            : ' External PR metadata remains outside this native result.';
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Hosted engine validation ${result.status}: ${result.receipts.succeeded} sealed cases passed and ${result.jobs.skipped} jobs were inapplicable.${externalSummary}\n`
          );
        }
      }
    } else {
      preflight(root, { testsOnly: has('--tests-only') });
      const plan = createPlan(root, {
        testsOnly: has('--tests-only'),
        canonicalTypescript: !has('--tests-only'),
      });
      if (has('--plan')) {
        if (!has('--tests-only'))
          plan.stagedCoverage = {
            stages: ['repository', 'codeql', 'build', 'browser'],
            supplementalScope: 'full',
            executionPrerequisites: [
              'owned actual-working-byte source snapshot',
              'read-only installed dependencies matching the source lockfile',
              'verified native tool versions and pack closures',
              'actual OS browser/provider network boundary',
              'verified isolated Docker fixture prerequisites where required',
            ],
            githubMetadata: 'pending until an actual PR exists',
            status: 'planned-only; no prerequisite execution or result reuse',
          };
        if (has('--json'))
          process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        else {
          printPlan(plan);
          if (plan.stagedCoverage)
            process.stdout.write(
              '\nFull gate also stages CodeQL, builds, browser and supplemental native checks.\nPrerequisites are verified only on execution; GitHub PR metadata remains pending.\n'
            );
        }
      } else {
        printPlan(plan, process.stdout, { details: false });
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', interrupt);
        if (has('--tests-only')) {
          const totals = await executePlan(plan, { signal: controller.signal });
          for (const [lane, count] of totals)
            process.stdout.write(
              `${lane}: ${count.total} tests, ${count.active} active\n`
            );
          process.stdout.write('\nLocal tests passed.\n');
        } else {
          context = await createNativeStageContext(root, {
            signal: controller.signal,
          });
          if (context.report.blockedRequired.length) {
            for (const blocker of context.report.blockedRequired)
              process.stderr.write(`${blocker.id}: ${blocker.reason}\n`);
            process.stderr.write(
              `\nFull validation incomplete; no full stages executed. Preparation evidence: ${context.report.artifacts}\n`
            );
            failure = { preserveTemporary: true };
            process.exitCode = 1;
          } else {
            const result = await executeStagedValidation(
              context.binding,
              context.options
            );
            const pendingRequired = context.pendingMetadata.filter(
              (check) => check.required
            );
            const complete = result.ok && pendingRequired.length === 0;
            const report = {
              ...result,
              status: complete
                ? 'passed'
                : result.ok
                  ? 'incomplete'
                  : result.status,
              ok: complete,
              pendingGithubMetadata: context.pendingMetadata,
              derivedArtifacts: context.derivedArtifacts,
              derivedCoverageReferences:
                context.report.derivedCoverageReferences,
              candidate: context.snapshot.candidate,
            };
            const reportPath = resolve(
              context.snapshot.scratchRoot,
              'native-validation-result.json'
            );
            writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
              flag: 'wx',
            });
            process.stdout.write(
              `\nFull native validation ${report.status}. Actual execution evidence: ${reportPath}\n`
            );
            // Retain completed evidence as well as failures; explicit owned cleanup
            // is available through the context API after durable evidence handoff.
            failure = { preserveTemporary: true };
            if (!complete) process.exitCode = 1;
          }
        }
      }
    }
  } catch (error) {
    failure = context ? { ...error, preserveTemporary: true } : error;
    process.stderr.write(`${error.message}\n`);
    if (error.scratchRoot)
      process.stderr.write(
        `Preparation evidence retained: ${error.scratchRoot}\n`
      );
    process.exitCode = controller.signal.aborted ? 130 : error.exitCode || 1;
  } finally {
    if (context) {
      try {
        await context.cleanup(failure);
      } catch (error) {
        process.stderr.write(
          `Post-validation source guard: ${error.message}\n`
        );
        process.exitCode ||= 1;
      }
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
