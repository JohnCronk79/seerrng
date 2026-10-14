#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const CONFIG_FILE = 'vroom-app.cfg';
const RESOURCE_FILE = 'vroom.cfg';
const USER_DATA_FOLDER = 'vroom-user-data';
const TIMING_LOG_FOLDER = 'test-timming-logs';
const TIMING_LOG_LIMIT = 5;
const DEFAULT_WORKLOAD = 'dev';
const VROOM_ROOT = dirname(fileURLToPath(import.meta.url));

// A. CliInterface
// Owns the user-facing command syntax. It prints help when requested, validates
// the application-folder and optional workload arguments, resolves the
// application path, applies dev as the default workload, and selects local,
// GitHub execution, or GitHub plan-only mode. It does not read configuration
// or execute work.
function CliInterface(args) {
  const help = `Usage: node vroom.mjs <application-folder> [workload] [--github | --github-plan]

Runs a workload from <application-folder>\\${CONFIG_FILE}.
The workload defaults to "${DEFAULT_WORKLOAD}" when omitted.
Use --github only inside GitHub Actions to select Mode 2 execution.
Use --github-plan inside GitHub Actions to emit the configured VM matrix
without executing the workload.

Examples:
  node vroom.mjs C:\\path\\to\\application
  node vroom.mjs C:\\path\\to\\application dev
  node vroom.mjs C:\\path\\to\\application compile
  node vroom.mjs C:\\path\\to\\application pre-pr
  node vroom.mjs /work/application github --github-plan
  node vroom.mjs /work/application github --github
`;

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(help);
    return null;
  }
  const githubFlags = args.filter(
    (argument) => argument === '--github' || argument === '--github-plan'
  );
  const positional = args.filter(
    (argument) => argument !== '--github' && argument !== '--github-plan'
  );
  if (
    args.some(
      (argument) =>
        argument.startsWith('-') &&
        argument !== '--github' &&
        argument !== '--github-plan'
    ) ||
    githubFlags.length > 1 ||
    positional.length < 1 ||
    positional.length > 2
  )
    throw new Error(`Invalid arguments.\n\n${help}`);

  const workload = positional[1] ?? DEFAULT_WORKLOAD;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(workload))
    throw new Error(`Invalid workload name: ${workload}`);

  const githubPlan = githubFlags[0] === '--github-plan';
  const executionMode = githubFlags.length ? 'github' : 'local';
  if (executionMode === 'github' && process.env.GITHUB_ACTIONS !== 'true')
    throw new Error(`${githubPlan ? '--github-plan' : '--github'} requires the GitHub Actions environment`);

  return {
    applicationRoot: resolve(positional[0]),
    workload,
    executionMode,
    githubPlan,
  };
}

// B. loadApplicationConfiguration
// Owns application configuration intake. It confirms the application folder,
// reads vroom-app.cfg, parses its workload sections and job metadata, selects
// the requested workload, creates the job records, validates application-owned
// file lists, changed-file rules, and fixed non-secret job environments, and
// rejects missing dependencies or dependency cycles. It does not decide
// execution order or run jobs.
async function loadApplicationConfiguration(applicationRoot, workload) {
  let applicationStats;
  try {
    applicationStats = await stat(applicationRoot);
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(`Application folder does not exist: ${applicationRoot}`);
    throw error;
  }
  if (!applicationStats.isDirectory())
    throw new Error(`Application path is not a folder: ${applicationRoot}`);

  const configPath = join(applicationRoot, CONFIG_FILE);
  let source;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing application configuration: ${configPath}`);
    throw error;
  }

  const sections = new Map();
  let currentSection = null;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    const line = original.trim();
    const lineNumber = index + 1;
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    const sectionMatch = /^\[([a-z0-9][a-z0-9-]*)\]$/i.exec(line);
    if (sectionMatch) {
      if (sections.has(sectionMatch[1]))
        throw new Error(`${configPath}:${lineNumber}: duplicate [${sectionMatch[1]}] section`);
      currentSection = new Map();
      sections.set(sectionMatch[1], currentSection);
      continue;
    }
    if (!currentSection)
      throw new Error(`${configPath}:${lineNumber}: setting appears before a section`);

    const separator = original.indexOf('=');
    if (separator < 1)
      throw new Error(`${configPath}:${lineNumber}: expected name = value`);
    const key = original.slice(0, separator).trim();
    const value = original.slice(separator + 1).trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(key))
      throw new Error(`${configPath}:${lineNumber}: invalid setting name: ${key}`);
    if (!value) throw new Error(`${configPath}:${lineNumber}: ${key} has no value`);
    if (currentSection.has(key))
      throw new Error(`${configPath}:${lineNumber}: duplicate setting: ${key}`);
    currentSection.set(key, { value, lineNumber });
  }

  if (!sections.size) throw new Error(`${configPath}: no workload sections found`);
  const selected = sections.get(workload);
  if (!selected)
    throw new Error(
      `Workload [${workload}] is not defined in ${configPath}. Available: ${[
        ...sections.keys(),
      ].join(', ')}`
    );
  const profileNames = [];
  const profileEntry = selected.get('profiles');
  if (profileEntry) {
    for (const rawName of profileEntry.value.split(',')) {
      const name = rawName.trim();
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(name))
        throw new Error(
          `${configPath}:${profileEntry.lineNumber}: invalid profile name: ${name}`
        );
      if (profileNames.includes(name))
        throw new Error(
          `${configPath}:${profileEntry.lineNumber}: duplicate profile name: ${name}`
        );
      profileNames.push(name);
    }
  }
  const profiles = profileNames.map((name) => {
    const key = `profile.${name}.jobs`;
    const entry = selected.get(key);
    if (!entry)
      throw new Error(
        `${configPath}:${profileEntry.lineNumber}: profile ${name} requires ${key}`
      );
    const jobs = entry.value
      .split(',')
      .map((jobName) => jobName.trim())
      .filter(Boolean);
    if (!jobs.length)
      throw new Error(`${configPath}:${entry.lineNumber}: ${key} contains no jobs`);
    if (new Set(jobs).size !== jobs.length)
      throw new Error(`${configPath}:${entry.lineNumber}: ${key} contains duplicate jobs`);
    return { name, jobs, lineNumber: entry.lineNumber };
  });
  const knownProfileSettings = new Set([
    'profiles',
    ...profiles.map((profile) => `profile.${profile.name}.jobs`),
  ]);
  for (const [key, entry] of selected) {
    if (key === 'profiles' || key.startsWith('profile.')) {
      if (!knownProfileSettings.has(key))
        throw new Error(`${configPath}:${entry.lineNumber}: unknown profile setting: ${key}`);
    }
  }

  const records = new Map();
  for (const [key, entry] of selected) {
    if (key === 'profiles' || key.startsWith('profile.')) continue;
    const metadataMatch = /^(.+)\.(kind|after|exclusive|when|compare|files|env)$/.exec(key);
    const jobName = metadataMatch ? metadataMatch[1] : key;
    if (!records.has(jobName)) records.set(jobName, { name: jobName, metadata: {} });
    const record = records.get(jobName);
    if (metadataMatch) record.metadata[metadataMatch[2]] = entry;
    else record.command = entry;
  }

  const validKinds = new Set(['check', 'prepare', 'build', 'post-build']);
  const jobs = [];
  for (const record of records.values()) {
    if (!record.command) {
      let firstMetadata;
      for (const metadata of Object.values(record.metadata)) {
        firstMetadata = metadata;
        break;
      }
      throw new Error(
        `${configPath}:${firstMetadata.lineNumber}: metadata exists for missing job ${record.name}`
      );
    }

    const kind = record.metadata.kind?.value ?? 'check';
    if (!validKinds.has(kind))
      throw new Error(
        `${configPath}:${record.metadata.kind.lineNumber}: invalid kind for ${record.name}: ${kind}`
      );
    const exclusiveText = record.metadata.exclusive?.value ?? 'false';
    if (exclusiveText !== 'true' && exclusiveText !== 'false')
      throw new Error(
        `${configPath}:${record.metadata.exclusive.lineNumber}: ${record.name}.exclusive must be true or false`
      );

    const dependencies = [];
    if (record.metadata.after) {
      for (const name of record.metadata.after.value.split(',')) {
        if (name.trim()) dependencies.push(name.trim());
      }
    }
    const when = record.metadata.when?.value
      .split(',')
      .map((pattern) => pattern.trim().replace(/\\/g, '/'))
      .filter(Boolean) ?? [];
    for (const pattern of when) {
      if (
        pattern.startsWith('/') ||
        pattern.includes('..') ||
        (pattern.includes('*') && !pattern.endsWith('/**'))
      )
        throw new Error(
          `${configPath}:${record.metadata.when.lineNumber}: ${record.name}.when supports relative paths and trailing /** only`
        );
    }
    const files = record.metadata.files?.value
      .split(',')
      .map((file) => file.trim().replace(/\\/g, '/'))
      .filter(Boolean) ?? [];
    for (const file of files) {
      if (
        file.startsWith('/') ||
        file.includes('..') ||
        file.includes('*') ||
        !/^[a-z0-9_./@+-]+$/i.test(file)
      )
        throw new Error(
          `${configPath}:${record.metadata.files.lineNumber}: ${record.name}.files supports comma-separated relative file or folder paths only`
        );
    }
    const compare = record.metadata.compare?.value ?? null;
    if (compare && !/^[a-z0-9][a-z0-9._/@+-]*$/i.test(compare))
      throw new Error(
        `${configPath}:${record.metadata.compare.lineNumber}: invalid Git comparison ref for ${record.name}`
      );
    if (compare && !when.length)
      throw new Error(
        `${configPath}:${record.metadata.compare.lineNumber}: ${record.name}.compare requires ${record.name}.when`
      );
    const environment = {};
    if (record.metadata.env) {
      for (const rawAssignment of record.metadata.env.value.split(',')) {
        const assignment = rawAssignment.trim();
        const separator = assignment.indexOf('=');
        const name = separator > 0 ? assignment.slice(0, separator).trim() : '';
        const value = separator > 0 ? assignment.slice(separator + 1).trim() : '';
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !value)
          throw new Error(
            `${configPath}:${record.metadata.env.lineNumber}: ${record.name}.env requires comma-separated NAME=value entries`
          );
        if (name.startsWith('VROOM_'))
          throw new Error(
            `${configPath}:${record.metadata.env.lineNumber}: ${record.name}.env cannot override Vroom-owned ${name}`
          );
        if (Object.hasOwn(environment, name))
          throw new Error(
            `${configPath}:${record.metadata.env.lineNumber}: duplicate ${name} in ${record.name}.env`
          );
        environment[name] = value;
      }
    }
    jobs.push({
      name: record.name,
      command: record.command.value,
      lineNumber: record.command.lineNumber,
      kind,
      after: dependencies,
      exclusive: exclusiveText === 'true',
      when,
      compare: when.length ? compare ?? 'main' : null,
      files,
      environment,
    });
  }

  const knownNames = new Set();
  for (const job of jobs) knownNames.add(job.name);
  const profileByJob = new Map();
  for (const profile of profiles) {
    for (const jobName of profile.jobs) {
      if (!knownNames.has(jobName))
        throw new Error(
          `${configPath}:${profile.lineNumber}: profile ${profile.name} lists missing job ${jobName}`
        );
      if (profileByJob.has(jobName))
        throw new Error(
          `${configPath}:${profile.lineNumber}: job ${jobName} belongs to both ${profileByJob.get(jobName)} and ${profile.name}`
        );
      profileByJob.set(jobName, profile.name);
    }
  }
  for (const job of jobs) {
    for (const dependency of job.after) {
      if (dependency === job.name)
        throw new Error(`${configPath}: ${job.name} cannot depend on itself`);
      if (!knownNames.has(dependency))
        throw new Error(
          `${configPath}:${job.lineNumber}: ${job.name} depends on missing job ${dependency}`
        );
    }
  }

  const remainingDependencies = new Map();
  for (const job of jobs) remainingDependencies.set(job.name, job.after.length);
  const readyNames = [];
  for (const [name, count] of remainingDependencies) if (count === 0) readyNames.push(name);
  let visited = 0;
  while (readyNames.length) {
    const completedName = readyNames.shift();
    visited += 1;
    for (const job of jobs) {
      if (!job.after.includes(completedName)) continue;
      const count = remainingDependencies.get(job.name) - 1;
      remainingDependencies.set(job.name, count);
      if (count === 0) readyNames.push(job.name);
    }
  }
  if (visited !== jobs.length)
    throw new Error(`${configPath}: dependency cycle in [${workload}]`);
  if (!jobs.length) throw new Error(`Workload [${workload}] contains no jobs`);

  return { applicationRoot, configPath, workload, profiles, jobs };
}

// C. loadVroomConfiguration
// Owns every task involving Vroom's root vroom.cfg. It reads, parses, validates,
// and normalizes the local, GitHub, controller, and Mode 3 node settings so the
// rest of Vroom receives configuration data without handling the file itself.
// Future vroom.cfg features remain contained in this function.
async function loadVroomConfiguration() {
  const configPath = join(VROOM_ROOT, RESOURCE_FILE);
  let source;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(`Missing Vroom resource configuration: ${configPath}`);
    throw error;
  }

  const sections = new Map();
  let section = null;
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = /^\[([a-z0-9][a-z0-9 -]*)\]$/i.exec(line);
    if (sectionMatch) {
      const name = sectionMatch[1].trim().toLowerCase().replace(/\s+/g, ' ');
      if (sections.has(name))
        throw new Error(`${configPath}:${index + 1}: duplicate [${name}] section`);
      section = new Map();
      sections.set(name, section);
      continue;
    }
    if (!section)
      throw new Error(`${configPath}:${index + 1}: setting appears before a section`);
    const separator = original.indexOf('=');
    if (separator < 1)
      throw new Error(`${configPath}:${index + 1}: expected name = value`);
    const key = original.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = original.slice(separator + 1).trim();
    if (!value) throw new Error(`${configPath}:${index + 1}: ${key} has no value`);
    if (section.has(key))
      throw new Error(`${configPath}:${index + 1}: duplicate setting: ${key}`);
    section.set(key, { value, lineNumber: index + 1 });
  }

  for (const required of ['local', 'github', 'cluster']) {
    if (!sections.has(required))
      throw new Error(`${configPath}: missing [${required}] section`);
  }

  const readInteger = (entry, label, maximum = 256) => {
    const value = Number(entry?.value);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error(
        `${configPath}${entry ? `:${entry.lineNumber}` : ''}: ${label} must be 1-${maximum}`
      );
    return value;
  };
  const readBoolean = (entry, label) => {
    if (!entry || !['true', 'false'].includes(entry.value.toLowerCase()))
      throw new Error(
        `${configPath}${entry ? `:${entry.lineNumber}` : ''}: ${label} must be true or false`
      );
    return entry.value.toLowerCase() === 'true';
  };
  const readThreadPolicy = (expressionEntry, minimumEntry, label) => {
    const expression = expressionEntry?.value.toLowerCase().replace(/\s+/g, '');
    if (!expression || !/^(?:[1-9][0-9]*|(?:[1-9][0-9]*)?n(?:[+-][0-9]+)?)$/.test(expression))
      throw new Error(
        `${configPath}${expressionEntry ? `:${expressionEntry.lineNumber}` : ''}: ${label} threads must be n, n-1, 2n, or a positive number`
      );
    const minimum = readInteger(minimumEntry, `${label} minimum thread count`);
    return { expression, minimum };
  };

  const local = sections.get('local');
  const github = sections.get('github');
  const cluster = sections.get('cluster');
  const nodes = [];
  for (const [name, node] of sections) {
    const match = /^cluster node (0[1-9]|[1-9][0-9])$/.exec(name);
    if (!match || !readBoolean(node.get('enabled'), `${name} enabled`)) continue;
    nodes.push({
      id: `node${match[1]}`,
      name: node.get('computer name')?.value ?? `Node ${match[1]}`,
      availableThreads: readInteger(node.get('available threads'), `${name} available threads`),
      threadPolicy: readThreadPolicy(
        node.get('threads'),
        node.get('minimum thread count'),
        name
      ),
    });
  }

  return {
    configPath,
    local: {
      threadPolicy: readThreadPolicy(
        local.get('threads'),
        local.get('minimum thread count'),
        'local'
      ),
    },
    github: {
      virtualMachines: readInteger(
        github.get('virtual machines'),
        'github virtual machines',
        20
      ),
      availableThreadsPerMachine: readInteger(
        github.get('available threads per machine'),
        'github available threads per machine'
      ),
      threadPolicy: readThreadPolicy(
        github.get('threads'),
        github.get('minimum thread count'),
        'github'
      ),
    },
    cluster: {
      controllerThreadPolicy: readThreadPolicy(
        cluster.get('controller threads'),
        cluster.get('controller minimum thread count'),
        'cluster controller'
      ),
      nodes,
    },
  };
}

// D. CpuThreadPanning
// Owns CPU and thread planning for local, GitHub, and cluster execution. It
// combines normalized Vroom configuration with live or configured resources
// and returns one generic weighted target map. Shared GitHub VMs keep equal
// configured weights because provider-load variation is noise. Local and Mode 3
// cluster targets ask TimingResults for measured performance. Scheduler owns
// all work assignment.
async function CpuThreadPanning(mode, configuration, timingRequest) {
  if (!['local', 'github', 'cluster'].includes(mode))
    throw new Error(`Unsupported execution mode: ${mode}`);

  const applyThreadPolicy = (policy, logicalCpus) => {
    const expression = policy.expression;
    let value;
    if (!expression.includes('n')) value = Number(expression);
    else {
      const match = /^(?<coefficient>[1-9][0-9]*)?n(?:(?<operator>[+-])(?<offset>[0-9]+))?$/.exec(expression);
      value = Number(match.groups.coefficient ?? 1) * logicalCpus;
      const offset = Number(match.groups.offset ?? 0);
      value += match.groups.operator === '-' ? -offset : offset;
    }
    return {
      expression,
      capacity: Math.min(256, Math.max(policy.minimum, value)),
    };
  };

  let quotaCpus = null;
  if (process.platform === 'linux') {
    let quota;
    try {
      quota = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (quota) {
      if (quota.length !== 2 || !Number.isFinite(Number(quota[1])) || Number(quota[1]) <= 0)
        throw new Error('Invalid cgroup CPU quota');
      if (quota[0] !== 'max') quotaCpus = Number(quota[0]) / Number(quota[1]);
    } else {
      try {
        const amount = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'));
        const period = Number(readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'));
        if (amount !== -1) {
          if (!(period > 0)) throw new Error('Invalid legacy CPU quota');
          quotaCpus = amount / period;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  const availableLogicalCpus = availableParallelism();
  const visibleLogicalCpus = cpus().length;
  if (
    !Number.isSafeInteger(availableLogicalCpus) ||
    availableLogicalCpus < 1 ||
    !Number.isSafeInteger(visibleLogicalCpus) ||
    visibleLogicalCpus < 1 ||
    (quotaCpus !== null && (!Number.isFinite(quotaCpus) || quotaCpus <= 0))
  )
    throw new Error('Invalid CPU capacity');

  const effectiveLogicalCpus = Math.min(
    availableLogicalCpus,
    visibleLogicalCpus,
    quotaCpus === null ? availableLogicalCpus : Math.max(1, Math.floor(quotaCpus))
  );
  const targets = [];
  if (mode === 'local') {
    const policy = applyThreadPolicy(configuration.local.threadPolicy, effectiveLogicalCpus);
    targets.push({
      id: 'local',
      name: hostname(),
      role: 'controller-node',
      source: 'local',
      availableLogicalCpus,
      visibleLogicalCpus,
      quotaCpus,
      effectiveLogicalCpus,
      threadPolicy: policy.expression,
      capacity: policy.capacity,
    });
  } else if (mode === 'github') {
    const machineCount = configuration.github.virtualMachines;
    const logicalCpus = configuration.github.availableThreadsPerMachine;
    const policy = applyThreadPolicy(configuration.github.threadPolicy, logicalCpus);
    for (let number = 1; number <= machineCount; number += 1) {
      targets.push({
        id: `github-vm-${String(number).padStart(2, '0')}`,
        name: `GitHub VM ${String(number).padStart(2, '0')}`,
        role: 'node',
        source: 'github',
        availableLogicalCpus: logicalCpus,
        visibleLogicalCpus: logicalCpus,
        quotaCpus: null,
        effectiveLogicalCpus: logicalCpus,
        threadPolicy: policy.expression,
        capacity: policy.capacity,
      });
    }
  } else {
    const controllerPolicy = applyThreadPolicy(
      configuration.cluster.controllerThreadPolicy,
      effectiveLogicalCpus
    );
    targets.push({
      id: 'controller',
      name: hostname(),
      role: 'controller-node',
      source: 'cluster',
      availableLogicalCpus,
      visibleLogicalCpus,
      quotaCpus,
      effectiveLogicalCpus,
      threadPolicy: controllerPolicy.expression,
      capacity: controllerPolicy.capacity,
    });
    for (const node of configuration.cluster.nodes) {
      const logicalCpus = node.availableThreads;
      const policy = applyThreadPolicy(node.threadPolicy, logicalCpus);
      targets.push({
        id: node.id,
        name: node.name,
        role: 'node',
        source: 'cluster',
        availableLogicalCpus: logicalCpus,
        visibleLogicalCpus: logicalCpus,
        quotaCpus: null,
        effectiveLogicalCpus: logicalCpus,
        threadPolicy: policy.expression,
        capacity: policy.capacity,
      });
    }
  }

  const timingWeights =
    mode === 'github'
      ? { targetWeights: new Map(targets.map((target) => [target.id, 1])) }
      : await TimingResults({
          action: 'weights',
          applicationRoot: timingRequest.applicationRoot,
          workload: timingRequest.workload,
          profiles: timingRequest.profiles,
          selectedJobNames: timingRequest.selectedJobNames,
          mode,
          target: null,
          resourceTargets: targets,
        });
  for (const target of targets) {
    target.performanceWeight = timingWeights.targetWeights.get(target.id) ?? 1;
    target.weightedCapacity = target.capacity * target.performanceWeight;
  }

  return {
    mode,
    configPath: configuration.configPath,
    controllerId: mode === 'local' ? 'local' : mode === 'cluster' ? 'controller' : 'github',
    targets,
    totalCapacity: targets.reduce((total, target) => total + target.capacity, 0),
    totalWeightedCapacity: targets.reduce(
      (total, target) => total + target.weightedCapacity,
      0
    ),
  };
}

// E. ExecutionLocal
// Owns process execution on the current computer. Scheduler decides what runs,
// where it is assigned, and how much capacity it receives; ExecutionLocal only
// carries out that assignment and returns a normalized result.
function ExecutionLocal({ applicationRoot, executionCommand, shard, target, allocatedCapacity, mode = 'local', signal }) {
  const startedAt = new Date();
  const startedClock = Date.now();
  return new Promise((complete) => {
    const child = spawn(executionCommand, {
      cwd: applicationRoot,
      env: {
        ...process.env,
        ...shard.job.environment,
        VROOM_EXECUTION_MODE: mode,
        VROOM_TARGET_ID: target.id,
        VROOM_ALLOCATED_THREADS: String(allocatedCapacity),
      },
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let settled = false;
    let termination = Promise.resolve();
    let forceTermination;
    let terminationDetail = '';

    const interrupt = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        termination = new Promise((finished) => {
          const killer = spawn(
            join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { shell: false, windowsHide: true, stdio: 'ignore' }
          );
          killer.once('error', (error) => {
            terminationDetail = `process-tree cleanup warning: ${error.message}`;
            child.kill();
            finished();
          });
          killer.once('close', (code) => {
            if (code !== 0) {
              terminationDetail = `process-tree cleanup exited ${code}`;
              child.kill();
            }
            finished();
          });
        });
      } else {
        const childrenByParent = new Map();
        for (const entry of readdirSync('/proc')) {
          if (!/^\d+$/.test(entry)) continue;
          try {
            const processStat = readFileSync(`/proc/${entry}/stat`, 'utf8');
            const fields = processStat.slice(processStat.lastIndexOf(')') + 2).split(' ');
            const parentPid = Number(fields[1]);
            if (!childrenByParent.has(parentPid)) childrenByParent.set(parentPid, []);
            childrenByParent.get(parentPid).push(Number(entry));
          } catch {}
        }
        const ownedPids = [];
        const pendingPids = [child.pid];
        while (pendingPids.length) {
          const parentPid = pendingPids.shift();
          for (const childPid of childrenByParent.get(parentPid) ?? []) {
            ownedPids.push(childPid);
            pendingPids.push(childPid);
          }
        }
        termination = new Promise((finished) => {
          for (const pid of [child.pid, ...ownedPids.reverse()]) {
            try {
              process.kill(pid, 'SIGTERM');
            } catch (error) {
              if (error.code !== 'ESRCH') terminationDetail = error.message;
            }
          }
          forceTermination = setTimeout(() => {
            for (const pid of [child.pid, ...ownedPids]) {
              try {
                process.kill(pid, 'SIGKILL');
              } catch (error) {
                if (error.code !== 'ESRCH') terminationDetail = error.message;
              }
            }
            finished();
          }, 1000);
        });
      }
    };

    const finish = async (status, detail, exitCode = null) => {
      if (settled) return;
      settled = true;
      if (!signal.aborted) clearTimeout(forceTermination);
      signal.removeEventListener('abort', interrupt);
      await termination;
      const durationMs = Date.now() - startedClock;
      const finalDetail = [detail, terminationDetail].filter(Boolean).join('; ');
      process.stdout.write(
        `[${status}] ${shard.job.name} (${(Math.round(durationMs / 100) / 10).toFixed(1)}s)` +
          `${finalDetail ? ` - ${finalDetail}` : ''}\n`
      );
      complete({
        shardId: shard.id,
        jobName: shard.job.name,
        command: shard.historyCommand,
        executedCommand: executionCommand,
        behavior: shard.behavior,
        estimatedWeight: shard.estimatedWeight,
        targetId: target.id,
        targetCapacity: target.capacity,
        allocatedCapacity,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs,
        status,
        exitCode,
        detail: finalDetail,
      });
    };

    signal.addEventListener('abort', interrupt, { once: true });
    if (signal.aborted) interrupt();
    child.once('error', (error) => finish('failed', error.message));
    child.once('close', (code, childSignal) => {
      if (signal.aborted) finish('interrupted', 'Vroom was interrupted', code);
      else if (code === 0) finish('passed', '', code);
      else finish('failed', childSignal || `exit ${code ?? 1}`, code ?? 1);
    });
  });
}

// F. ExecutionGitHub
// Owns execution and receipt creation inside one assigned GitHub VM. It does
// not plan workloads, create shards, or select a target.
async function ExecutionGitHub(request) {
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('ExecutionGitHub requires the GitHub Actions environment');

  const requiredEnvironment = [
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_SHA',
    'GITHUB_JOB',
  ];
  const missing = requiredEnvironment.filter((name) => !process.env[name]);
  if (missing.length)
    throw new Error(`GitHub Actions environment is missing ${missing.join(', ')}`);

  const result = await ExecutionLocal({ ...request, mode: 'github' });
  const runScope = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const receiptFolder = join(request.applicationRoot, USER_DATA_FOLDER, 'github-receipts', runScope);
  await mkdir(receiptFolder, { recursive: true });
  const receiptPath = join(receiptFolder, `${request.shard.id}.json`);
  const receipt = {
    schema: 'vroom-github-receipt-v1',
    provider: 'github-actions',
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    commitSha: process.env.GITHUB_SHA,
    githubJob: process.env.GITHUB_JOB,
    workflow: process.env.GITHUB_WORKFLOW ?? '',
    shardId: result.shardId,
    jobName: result.jobName,
    targetId: result.targetId,
    allocatedThreads: result.allocatedCapacity,
    result: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    detail: result.detail,
  };
  try {
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(`GitHub receipt already exists for ${request.shard.id}: ${receiptPath}`);
    throw error;
  }
  return { ...result, receiptPath };
}

// G. ExecutionCluster
// Reserves the future Mode 3 transport boundary without becoming a scheduler.
async function ExecutionCluster() {
  throw new Error('ExecutionCluster is reserved for Mode 3 and is not implemented');
}

// H. TimingResults
// Owns timing-history intake and completed-result storage for the application
// that invoked Vroom. It reads comparable timing logs for Scheduler, validates
// and stores returned receipts, writes the combined timing record, and keeps
// only the latest five timing logs and GitHub receipt sets. For hosted work it
// downloads the expected GitHub artifacts itself and interprets their receipts
// and timing records. It does not schedule work or assign shards.
async function TimingResults(request) {
  const {
    action,
    applicationRoot,
    workload,
    profiles = [],
    selectedJobNames = [],
    mode,
    target,
    resources,
    results: suppliedResults = [],
    history = new Map(),
    githubReturn = null,
    resourceTargets = [],
  } = request;
  if (!['read', 'weights', 'save'].includes(action))
    throw new Error(`TimingResults received unsupported action: ${action}`);

  const userDataRoot = join(applicationRoot, USER_DATA_FOLDER);
  const workloadLogRoot = join(userDataRoot, TIMING_LOG_FOLDER, workload);
  const timingLogFolders = profiles.length
    ? profiles.map((profile) => ({ profile, path: join(workloadLogRoot, profile.name) }))
    : selectedJobNames.length || suppliedResults.length || githubReturn
      ? [{ profile: null, path: workloadLogRoot }]
      : [];
  const timingPrefix = `${mode}-timing-`;
  for (const source of timingLogFolders) {
    await mkdir(source.path, { recursive: true });
    const existing = (await readdir(source.path))
      .filter((entry) => entry.startsWith(timingPrefix) && entry.endsWith('.log'))
      .sort();
    for (const expired of existing.slice(0, -TIMING_LOG_LIMIT))
      await unlink(join(source.path, expired));
  }

  if (action === 'read' || action === 'weights') {
    const loadedHistory = new Map();
    const performanceSamples = new Map();
    for (const source of timingLogFolders) {
      const timingFiles = (await readdir(source.path))
        .filter((entry) => entry.startsWith(timingPrefix) && entry.endsWith('.log'))
        .sort();
      for (const name of timingFiles) {
        try {
          const record = JSON.parse(await readFile(join(source.path, name), 'utf8'));
          if (record.schema !== 'vroom-timing-v1' || !Array.isArray(record.results)) continue;
          const workerGroup = record.results
            .filter(
              (result) =>
                result.status === 'passed' &&
                result.behavior === 'worker-based' &&
                Number.isInteger(result.allocatedCapacity) &&
                result.allocatedCapacity > 0
            )
            .map((result) => result.jobName)
            .sort()
            .join('\u0000');
          for (const result of record.results) {
            if (source.profile && !source.profile.jobs.includes(result.jobName)) continue;
            if (
              result.status === 'passed' &&
              typeof result.targetId === 'string' &&
              Number.isFinite(result.estimatedWeight) &&
              result.estimatedWeight > 0 &&
              Number.isFinite(result.durationMs) &&
              result.durationMs > 0 &&
              Number.isInteger(result.allocatedCapacity) &&
              result.allocatedCapacity > 0
            ) {
              if (!performanceSamples.has(result.targetId))
                performanceSamples.set(result.targetId, []);
              performanceSamples
                .get(result.targetId)
                .push(
                  result.estimatedWeight /
                    (result.durationMs * result.allocatedCapacity)
                );
            }
            if (
              result.status !== 'passed' ||
              typeof result.jobName !== 'string' ||
              typeof result.command !== 'string' ||
              !Number.isFinite(result.durationMs) ||
              (target && result.targetCapacity !== target.capacity)
            )
              continue;
            const key = `${result.jobName}\u0000${result.command}`;
            if (!loadedHistory.has(key)) loadedHistory.set(key, []);
            loadedHistory.get(key).push({
              durationMs: result.durationMs,
              allocatedCapacity:
                Number.isInteger(result.allocatedCapacity) && result.allocatedCapacity > 0
                  ? result.allocatedCapacity
                  : 1,
              targetId: result.targetId,
              targetCapacity: result.targetCapacity,
              workerGroup,
            });
          }
        } catch {
          process.stderr.write(
            `Vroom warning: ignored unreadable timing log ${join(source.path, name)}\n`
          );
        }
      }
    }
    if (action === 'weights') {
      const measuredPerformance = new Map();
      for (const resourceTarget of resourceTargets) {
        const samples = (performanceSamples.get(resourceTarget.id) ?? [])
          .slice(-5)
          .sort((left, right) => left - right);
        const sampleMidpoint = Math.floor(samples.length / 2);
        measuredPerformance.set(
          resourceTarget.id,
          samples.length
            ? samples.length % 2
              ? samples[sampleMidpoint]
              : (samples[sampleMidpoint - 1] + samples[sampleMidpoint]) / 2
            : null
        );
      }
      const measured = [...measuredPerformance.values()].filter(
        (value) => Number.isFinite(value) && value > 0
      );
      measured.sort((left, right) => left - right);
      const midpoint = Math.floor(measured.length / 2);
      const baseline = measured.length
        ? measured.length % 2
          ? measured[midpoint]
          : (measured[midpoint - 1] + measured[midpoint]) / 2
        : 1;
      const targetWeights = new Map();
      for (const resourceTarget of resourceTargets) {
        const performance = measuredPerformance.get(resourceTarget.id);
        const relativeWeight = performance ? performance / baseline : 1;
        targetWeights.set(
          resourceTarget.id,
          Math.round(Math.min(4, Math.max(0.25, relativeWeight)) * 1000) / 1000
        );
      }
      return { targetWeights, timingLogFolders };
    }
    return { history: loadedHistory, timingLogFolders };
  }

  let completedResults = suppliedResults;
  const downloadedReceipts = new Map();
  if (githubReturn) {
    if (mode !== 'github') throw new Error('GitHub artifact return requires GitHub mode');
    const repository = String(githubReturn.repository ?? '').trim();
    const runId = String(githubReturn.runId ?? '').trim();
    const runAttempt = String(githubReturn.runAttempt ?? '').trim();
    const token = String(githubReturn.token ?? '').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
      throw new Error('GitHub artifact return requires an owner/repository name');
    if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt))
      throw new Error('GitHub artifact return requires numeric run and attempt identities');
    if (!token) throw new Error('GitHub artifact return requires an API token');
    const apiRoot = String(githubReturn.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Vroom',
    };
    const listResponse = await fetch(
      `${apiRoot}/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`,
      { headers }
    );
    if (!listResponse.ok)
      throw new Error(`Unable to list GitHub artifacts: HTTP ${listResponse.status}`);
    const listing = await listResponse.json();
    if (!Array.isArray(listing.artifacts))
      throw new Error('GitHub artifact listing did not contain an artifact list');
    if (Number(listing.total_count) > listing.artifacts.length)
      throw new Error('GitHub artifact return exceeded one result page');
    const artifactPrefix =
      githubReturn.artifactPrefix ?? `vroom-mode2-${runId}-${runAttempt}-`;
    const artifacts = listing.artifacts
      .filter(
        (artifact) =>
          !artifact.expired &&
          typeof artifact.name === 'string' &&
          artifact.name.startsWith(artifactPrefix) &&
          typeof artifact.archive_download_url === 'string'
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!artifacts.length)
      throw new Error(`No current GitHub result artifacts matched ${artifactPrefix}`);

    const timingRecords = [];
    for (const artifact of artifacts) {
      const archiveResponse = await fetch(artifact.archive_download_url, { headers });
      if (!archiveResponse.ok)
        throw new Error(
          `Unable to download GitHub artifact ${artifact.name}: HTTP ${archiveResponse.status}`
        );
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      if (archive.length > 32 * 1024 * 1024)
        throw new Error(`GitHub artifact ${artifact.name} exceeds the 32 MiB result limit`);
      let endOffset = -1;
      for (let index = Math.max(0, archive.length - 65_557); index <= archive.length - 22; index += 1) {
        if (archive.readUInt32LE(index) === 0x06054b50) endOffset = index;
      }
      if (endOffset < 0) throw new Error(`GitHub artifact ${artifact.name} is not a ZIP archive`);
      const entryCount = archive.readUInt16LE(endOffset + 10);
      let directoryOffset = archive.readUInt32LE(endOffset + 16);
      if (entryCount > 1000)
        throw new Error(`GitHub artifact ${artifact.name} contains too many result files`);
      let expandedBytes = 0;
      for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
        if (archive.readUInt32LE(directoryOffset) !== 0x02014b50)
          throw new Error(`GitHub artifact ${artifact.name} has an invalid ZIP directory`);
        const flags = archive.readUInt16LE(directoryOffset + 8);
        const method = archive.readUInt16LE(directoryOffset + 10);
        const compressedSize = archive.readUInt32LE(directoryOffset + 20);
        const expandedSize = archive.readUInt32LE(directoryOffset + 24);
        const nameLength = archive.readUInt16LE(directoryOffset + 28);
        const extraLength = archive.readUInt16LE(directoryOffset + 30);
        const commentLength = archive.readUInt16LE(directoryOffset + 32);
        const localOffset = archive.readUInt32LE(directoryOffset + 42);
        const name = archive
          .subarray(directoryOffset + 46, directoryOffset + 46 + nameLength)
          .toString('utf8')
          .replace(/\\/g, '/');
        directoryOffset += 46 + nameLength + extraLength + commentLength;
        if (!name || name.endsWith('/')) continue;
        if (flags & 1) throw new Error(`GitHub artifact ${artifact.name} is encrypted`);
        if (name.startsWith('/') || name.split('/').includes('..'))
          throw new Error(`GitHub artifact ${artifact.name} contains an unsafe result path`);
        if (archive.readUInt32LE(localOffset) !== 0x04034b50)
          throw new Error(`GitHub artifact ${artifact.name} has an invalid ZIP entry`);
        const localNameLength = archive.readUInt16LE(localOffset + 26);
        const localExtraLength = archive.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
        let data;
        if (method === 0) data = compressed;
        else if (method === 8) data = inflateRawSync(compressed);
        else throw new Error(`GitHub artifact ${artifact.name} uses unsupported ZIP method ${method}`);
        if (data.length !== expandedSize)
          throw new Error(`GitHub artifact ${artifact.name} has a damaged ZIP entry`);
        expandedBytes += data.length;
        if (expandedBytes > 64 * 1024 * 1024)
          throw new Error(`GitHub artifact ${artifact.name} expands beyond 64 MiB`);
        let record;
        try {
          record = JSON.parse(data.toString('utf8'));
        } catch {
          continue;
        }
        if (record.schema === 'vroom-github-receipt-v1') {
          if (
            String(record.runId) !== runId ||
            String(record.runAttempt) !== runAttempt ||
            record.repository !== repository
          )
            throw new Error(`GitHub artifact ${artifact.name} returned a foreign receipt`);
          if (downloadedReceipts.has(record.shardId))
            throw new Error(`GitHub artifact return duplicated receipt ${record.shardId}`);
          downloadedReceipts.set(record.shardId, record);
        } else if (record.schema === 'vroom-timing-v1') {
          if (record.executionMode !== 'github' || !Array.isArray(record.results))
            throw new Error(`GitHub artifact ${artifact.name} returned invalid timing data`);
          timingRecords.push(record);
        }
      }
    }
    if (!downloadedReceipts.size)
      throw new Error('GitHub artifact return contained no Vroom receipts');
    const returnedResults = [];
    for (const receipt of downloadedReceipts.values()) {
      const matches = timingRecords
        .flatMap((record) => record.results)
        .filter(
          (result) =>
            result.shardId === receipt.shardId &&
            result.jobName === receipt.jobName &&
            result.targetId === receipt.targetId &&
            result.allocatedCapacity === receipt.allocatedThreads &&
            result.status === receipt.result &&
            result.exitCode === receipt.exitCode
        );
      if (matches.length !== 1)
        throw new Error(
          `GitHub artifact return expected one timing result for ${receipt.shardId}; found ${matches.length}`
        );
      returnedResults.push(matches[0]);
    }
    completedResults = returnedResults.sort(
      (left, right) =>
        left.jobName.localeCompare(right.jobName) || left.shardId.localeCompare(right.shardId)
    );
  }

  const receiptPaths = [];
  if (mode === 'github') {
    const acceptedReceiptPaths = new Set();
    for (const result of completedResults.filter((entry) => entry.allocatedCapacity > 0)) {
      const downloadedReceipt = downloadedReceipts.get(result.shardId);
      const receiptIdentity = downloadedReceipt ? `download:${result.shardId}` : result.receiptPath;
      if (!receiptIdentity || acceptedReceiptPaths.has(receiptIdentity))
        throw new Error(`GitHub receipt reconciliation failed for ${result.shardId}`);
      let receipt;
      if (downloadedReceipt) receipt = downloadedReceipt;
      else {
        try {
          receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
        } catch (error) {
          throw new Error(`Unable to read GitHub receipt for ${result.shardId}: ${error.message}`);
        }
      }
      if (
        receipt.schema !== 'vroom-github-receipt-v1' ||
        receipt.shardId !== result.shardId ||
        receipt.jobName !== result.jobName ||
        receipt.targetId !== result.targetId ||
        receipt.allocatedThreads !== result.allocatedCapacity ||
        receipt.result !== result.status ||
        receipt.exitCode !== result.exitCode
      )
        throw new Error(`GitHub receipt does not match execution result for ${result.shardId}`);
      const runScope = `${receipt.runId}-${receipt.runAttempt}`;
      const receiptFolder = join(userDataRoot, 'github-receipts', runScope);
      const receiptPath = join(receiptFolder, `${result.shardId}.json`);
      await mkdir(receiptFolder, { recursive: true });
      if (downloadedReceipt || resolve(result.receiptPath) !== resolve(receiptPath))
        await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
        });
      acceptedReceiptPaths.add(receiptIdentity);
      receiptPaths.push(receiptPath);
      result.receiptPath = receiptPath;
    }
    const receiptRoot = join(userDataRoot, 'github-receipts');
    await mkdir(receiptRoot, { recursive: true });
    const retainedReceiptSets = (await readdir(receiptRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const expired of retainedReceiptSets.slice(0, -TIMING_LOG_LIMIT))
      await rm(join(receiptRoot, expired), { recursive: true, force: true });
    process.stdout.write(`GitHub receipts accepted: ${acceptedReceiptPaths.size}\n`);
  }

  if (!completedResults.length)
    return { results: completedResults, receiptPaths, timingLogPaths: [], timingLogFolders };
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const timingRecord = {
    schema: 'vroom-timing-v1',
    executionMode: mode,
    workload,
    profiles: profiles.map((profile) => profile.name),
    applicationRoot,
    controllerId: resources.controllerId,
    startedWithHistory: history.size > 0,
    targets: resources.targets,
    results: completedResults.map((result) => {
      const previous = history.get(`${result.jobName}\u0000${result.command}`) ?? [];
      const samples =
        result.status === 'passed'
          ? [
              ...previous.slice(-4),
              {
                durationMs: result.durationMs,
                allocatedCapacity: Math.max(1, result.allocatedCapacity),
              },
            ]
          : previous.slice(-5);
      return {
        ...result,
        timingSamples: samples.length,
        averageDurationMs: samples.length
          ? Math.round(
              samples.reduce((total, sample) => total + sample.durationMs, 0) /
                samples.length
            )
          : null,
        averageWorkerMs: samples.length
          ? Math.round(
              samples.reduce(
                (total, sample) => total + sample.durationMs * sample.allocatedCapacity,
                0
              ) / samples.length
            )
          : null,
      };
    }),
  };
  const timingLogPaths = [];
  for (const source of timingLogFolders) {
    const timingLogPath = join(source.path, `${mode}-timing-${timestamp}.log`);
    await writeFile(timingLogPath, `${JSON.stringify(timingRecord, null, 2)}\n`, 'utf8');
    timingLogPaths.push(timingLogPath);
    const retainedTimingFiles = (await readdir(source.path))
      .filter((entry) => entry.startsWith(timingPrefix) && entry.endsWith('.log'))
      .sort();
    for (const expired of retainedTimingFiles.slice(0, -TIMING_LOG_LIMIT))
      await unlink(join(source.path, expired));
  }
  return { results: completedResults, receiptPaths, timingLogPaths, timingLogFolders };
}

// I. Scheduler
// Owns the one application-agnostic scheduler used by every Vroom mode. It
// creates and displays the application-work plan, loads Vroom configuration,
// obtains CPU and weighted target resources, resolves generic command behavior,
// creates and assigns deterministic local or multi-VM shards, emits the GitHub
// VM matrix, applies changed-file rules, enforces dependencies and exclusivity,
// asks TimingResults for timing history, uses that history to set execution
// order, balances worker capacity, executes nodes with their
// application-declared non-secret environments, handles cancellation and
// failures, and gives completed results back to TimingResults for receipt
// interpretation and durable storage. Destination-specific process handling
// remains in the Execution functions above.
async function Scheduler(
  configuration,
  mode,
  signal,
  { githubPlan = false, githubReturn = null } = {}
) {
  const kindOrder = new Map([
    ['check', 0],
    ['prepare', 1],
    ['build', 2],
    ['post-build', 3],
  ]);
  const jobs = [...configuration.jobs];
  jobs.sort(
    (left, right) =>
      kindOrder.get(left.kind) - kindOrder.get(right.kind) || left.name.localeCompare(right.name)
  );
  const plan = { ...configuration, jobs };

  process.stdout.write(
    `Vroom plan\n` +
      `Application: ${plan.applicationRoot}\n` +
      `Configuration: ${plan.configPath}\n` +
      `Workload: ${plan.workload}\n` +
      `Jobs:\n`
  );
  for (const job of plan.jobs) {
    const facts = [job.kind];
    if (job.after.length) facts.push(`after ${job.after.join(', ')}`);
    if (job.exclusive) facts.push('exclusive');
    if (job.when.length) facts.push(`when ${job.when.join(', ')}`);
    if (job.compare) facts.push(`compare ${job.compare}`);
    if (job.files.length) facts.push(`files ${job.files.join(', ')}`);
    process.stdout.write(`  - ${job.name} (${facts.join('; ')}): ${job.command}\n`);
  }
  process.stdout.write('\n');

  const plannedJobNames = plan.jobs.map((job) => job.name);
  const preliminaryTimingState = await TimingResults({
    action: 'read',
    applicationRoot: plan.applicationRoot,
    workload: plan.workload,
    profiles: plan.profiles,
    selectedJobNames: plannedJobNames,
    mode,
    target: null,
  });
  const vroomConfiguration = await loadVroomConfiguration();
  const resources = await CpuThreadPanning(mode, vroomConfiguration, {
    applicationRoot: plan.applicationRoot,
    workload: plan.workload,
    profiles: plan.profiles,
    selectedJobNames: plannedJobNames,
  });
  if (mode === 'github' && process.env.VROOM_GITHUB_RECONCILE === 'true') {
    const repository = process.env.GITHUB_REPOSITORY?.trim();
    const runId = process.env.GITHUB_RUN_ID?.trim();
    const runAttempt = process.env.GITHUB_RUN_ATTEMPT?.trim();
    const token = process.env.VROOM_GITHUB_TOKEN?.trim();
    if (!repository || !runId || !runAttempt || !token)
      throw new Error(
        'GitHub reconciliation requires repository, run, attempt, and token environment values'
      );
    const timingOutcome = await TimingResults({
      action: 'save',
      applicationRoot: plan.applicationRoot,
      workload: plan.workload,
      profiles: plan.profiles,
      selectedJobNames: plannedJobNames,
      mode,
      target: null,
      resources,
      results: [],
      history: preliminaryTimingState.history,
      githubReturn: { repository, runId, runAttempt, token },
    });
    if (process.env.VROOM_GITHUB_EXECUTION_RESULT !== 'success')
      throw new Error(
        `GitHub VM execution completed with ${process.env.VROOM_GITHUB_EXECUTION_RESULT ?? 'an unknown result'}`
      );
    return {
      resources,
      results: timingOutcome.results,
      receiptPaths: timingOutcome.receiptPaths,
      timingLogPaths: timingOutcome.timingLogPaths,
    };
  }
  const multiVmGithub = mode === 'github' && resources.targets.length > 1;
  const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
  const githubAssignments = new Map();
  if (multiVmGithub) {
    const unsupported = plan.jobs.filter((job) => job.after.length || job.exclusive);
    if (unsupported.length)
      throw new Error(
        `Multi-VM GitHub execution does not yet support cross-VM dependencies or exclusivity: ${unsupported.map((job) => job.name).join(', ')}`
      );

    for (let jobIndex = 0; jobIndex < plan.jobs.length; jobIndex += 1) {
      const job = plan.jobs[jobIndex];
      const assignments = resources.targets.map((resourceTarget, targetIndex) => ({
        targetId: resourceTarget.id,
        targetIndex,
        weightedCapacity: resourceTarget.weightedCapacity,
        estimatedWeight: 0,
        files: [],
        wholeJob: false,
      }));
      if (job.files.length) {
        const work = await Promise.all(
          job.files.map(async (file) => {
            const fileStats = await stat(join(plan.applicationRoot, file));
            return {
              file,
              estimatedWeight: fileStats.isFile() ? Math.max(1, fileStats.size) : 1,
            };
          })
        );
        work.sort(
          (left, right) =>
            right.estimatedWeight - left.estimatedWeight ||
            compareText(left.file, right.file)
        );
        for (const item of work) {
          const assignment = assignments.reduce((selected, candidate) => {
            const selectedLoad = selected.estimatedWeight / selected.weightedCapacity;
            const candidateLoad = candidate.estimatedWeight / candidate.weightedCapacity;
            if (candidateLoad < selectedLoad) return candidate;
            if (
              candidateLoad === selectedLoad &&
              candidate.targetIndex < selected.targetIndex
            )
              return candidate;
            return selected;
          });
          assignment.files.push(item.file);
          assignment.estimatedWeight += item.estimatedWeight;
        }
        for (const assignment of assignments) assignment.files.sort(compareText);
      } else {
        const assignment = assignments[jobIndex % assignments.length];
        assignment.wholeJob = true;
        assignment.estimatedWeight = 1;
      }
      githubAssignments.set(job.name, assignments);
    }
  }

  if (githubPlan) {
    if (mode !== 'github') throw new Error('--github-plan requires GitHub execution mode');
    const outputPath = process.env.GITHUB_OUTPUT?.trim();
    if (!outputPath) throw new Error('--github-plan requires GITHUB_OUTPUT');
    const matrix = { target: resources.targets.map((resourceTarget) => resourceTarget.id) };
    await appendFile(outputPath, `matrix=${JSON.stringify(matrix)}\n`, 'utf8');
    process.stdout.write(
      `GitHub VM matrix: ${matrix.target.join(', ')}\n` +
        `Configured capacity: ${resources.totalCapacity} thread slots across ${resources.targets.length} VM(s)\n`
    );
    for (const job of plan.jobs) {
      const assignments = githubAssignments.get(job.name);
      if (!assignments) continue;
      const summary = assignments
        .map((assignment) =>
          job.files.length
            ? `${assignment.targetId}=${assignment.files.length} file(s)`
            : `${assignment.targetId}=${assignment.wholeJob ? 'whole job' : 'no work'}`
        )
        .join(', ');
      process.stdout.write(`[assign] ${job.name}: ${summary}\n`);
    }
    return { resources, results: [], timingLogPaths: [], plannedOnly: true };
  }

  if (mode === 'cluster') await ExecutionCluster();
  const requestedTargetId = process.env.VROOM_GITHUB_TARGET_ID?.trim();
  let target = resources.targets[0];
  if (mode === 'github' && requestedTargetId)
    target = resources.targets.find((candidate) => candidate.id === requestedTargetId);
  else if (multiVmGithub)
    throw new Error('Multi-VM GitHub execution requires VROOM_GITHUB_TARGET_ID');
  if (!target || target.capacity < 1)
    throw new Error(
      requestedTargetId
        ? `Configured GitHub target does not exist or has no capacity: ${requestedTargetId}`
        : `${mode} execution target has no capacity`
    );
  const targetIndex = resources.targets.findIndex((candidate) => candidate.id === target.id);
  const execute = mode === 'github' ? ExecutionGitHub : ExecutionLocal;

  const changedFilesByReference = new Map();
  const selectedFilesByJob = new Map();
  for (const job of plan.jobs) {
    if (!job.when.length) {
      selectedFilesByJob.set(job.name, []);
      continue;
    }
    if (!changedFilesByReference.has(job.compare)) {
      const mergeBaseResult = spawnSync(
        'git',
        ['-C', plan.applicationRoot, 'merge-base', 'HEAD', job.compare],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      );
      if (mergeBaseResult.status !== 0)
        throw new Error(
          `Unable to compare ${plan.applicationRoot} with Git ref ${job.compare}: ${(mergeBaseResult.stderr ?? '').toString().trim() || 'git merge-base failed'}`
        );
      const mergeBase = (mergeBaseResult.stdout ?? '').toString().trim();
      const changedFiles = new Set();
      const gitQueries = [
        ['diff', '--name-only', '-z', '--diff-filter=ACMR', `${mergeBase}..HEAD`],
        ['diff', '--name-only', '-z', '--diff-filter=ACMR'],
        ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'],
        ['ls-files', '--others', '--exclude-standard', '-z'],
      ];
      for (const query of gitQueries) {
        const result = spawnSync('git', ['-C', plan.applicationRoot, ...query], {
          encoding: 'buffer',
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        });
        if (result.status !== 0)
          throw new Error(
            `Unable to read changed files for Git ref ${job.compare}: ${(result.stderr ?? Buffer.alloc(0)).toString('utf8').trim() || 'git query failed'}`
          );
        for (const file of (result.stdout ?? Buffer.alloc(0)).toString('utf8').split('\0')) {
          const normalized = file.trim().replace(/\\/g, '/');
          if (normalized) changedFiles.add(normalized);
        }
      }
      changedFilesByReference.set(job.compare, [...changedFiles].sort());
    }
    const selectedFiles = changedFilesByReference.get(job.compare).filter((file) =>
      job.when.some((pattern) => {
        if (!pattern.endsWith('/**')) return file === pattern;
        const root = pattern.slice(0, -3).replace(/\/$/, '');
        return file === root || file.startsWith(`${root}/`);
      })
    );
    for (const file of selectedFiles) {
      if (!/^[a-z0-9_./@+-]+$/i.test(file))
        throw new Error(
          `Changed path requires unsupported shell quoting; rename it before Vroom runs: ${file}`
        );
    }
    selectedFilesByJob.set(job.name, selectedFiles);
  }

  const selectedJobNames = plan.jobs
    .filter((job) => !job.when.length || selectedFilesByJob.get(job.name)?.length)
    .map((job) => job.name)
    .sort();
  const selectedJobSet = new Set(selectedJobNames);
  const activeProfiles = [];
  if (selectedJobNames.length && plan.profiles.length) {
    for (const profile of plan.profiles) {
      const selectedProfileJobs = profile.jobs.filter((jobName) => selectedJobSet.has(jobName));
      if (!selectedProfileJobs.length) continue;
      if (selectedProfileJobs.length !== profile.jobs.length)
        throw new Error(
          `${plan.configPath}: selected only part of ${plan.workload} profile ${profile.name}: ${selectedProfileJobs.join(', ')}`
        );
      activeProfiles.push(profile);
    }
    const profiledJobNames = new Set(activeProfiles.flatMap((profile) => profile.jobs));
    const unprofiledJobNames = selectedJobNames.filter((jobName) => !profiledJobNames.has(jobName));
    if (unprofiledJobNames.length)
      throw new Error(
        `${plan.configPath}: selected jobs do not belong to a declared ${plan.workload} profile: ${unprofiledJobNames.join(', ')}`
      );
  }
  let packageScripts = {};
  try {
    const packageJson = JSON.parse(
      await readFile(join(plan.applicationRoot, 'package.json'), 'utf8')
    );
    if (packageJson.scripts && typeof packageJson.scripts === 'object')
      packageScripts = packageJson.scripts;
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(`Unable to read application package.json: ${error.message}`);
  }

  const history = preliminaryTimingState.history;

  const commandCache = new Map();
  const shards = plan.jobs.map((job, index) => {
    let resolvedCommand = commandCache.get(job.command);
    if (!resolvedCommand) {
      resolvedCommand = job.command;
      const visited = new Set();
      for (let depth = 0; depth < 8; depth += 1) {
        const match = /^(?:pnpm(?:\s+run)?|npm\s+run|yarn)\s+([^\s]+)(?:\s+.*)?$/i.exec(
          resolvedCommand.trim()
        );
        const script = match?.[1];
        if (!script || visited.has(script) || typeof packageScripts[script] !== 'string') break;
        visited.add(script);
        resolvedCommand = packageScripts[script];
      }
      commandCache.set(job.command, resolvedCommand);
    }

    let behavior = 'conservative';
    if (/\b(vitest|jest|playwright\s+test|node\s+--test)\b/i.test(resolvedCommand))
      behavior = 'worker-based';
    else if (/\b(tsc|eslint|prettier|next\s+typegen)\b/i.test(resolvedCommand))
      behavior = 'single-process';

    const selectedFiles = selectedFilesByJob.get(job.name) ?? [];
    const githubAssignment = multiVmGithub
      ? githubAssignments.get(job.name)?.[targetIndex]
      : null;
    const assignedToTarget = !multiVmGithub
      ? true
      : job.files.length
        ? githubAssignment.files.length > 0
        : githubAssignment.wholeJob;
    const executionFiles = multiVmGithub ? githubAssignment.files : job.files;
    let historyCommand = executionFiles.length
      ? `${job.command}\u0000${executionFiles.join('\u0000')}`
      : job.command;
    const environmentEntries = Object.entries(job.environment).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    if (environmentEntries.length)
      historyCommand += `\u0000env\u0000${environmentEntries
        .map(([name, value]) => `${name}=${value}`)
        .join('\u0000')}`;
    return {
      id:
        mode === 'github'
          ? `shard-${String(index + 1).padStart(2, '0')}-${target.id}`
          : `shard-${String(index + 1).padStart(2, '0')}`,
      job,
      behavior,
      resolvedCommand,
      selectedFiles,
      executionFiles,
      assignedToTarget,
      estimatedWeight: githubAssignment?.estimatedWeight ?? null,
      historyCommand,
      timingSamples: history.get(`${job.name}\u0000${historyCommand}`) ?? [],
      averageDurationMs: null,
      averageWorkerMs: null,
      timingModel: null,
      originalOrder: index,
    };
  });

  const activeWorkerGroup = shards
    .filter(
      (shard) =>
        shard.assignedToTarget &&
        shard.behavior === 'worker-based' &&
        (!shard.job.when.length || shard.selectedFiles.length)
    )
    .map((shard) => shard.job.name)
    .sort()
    .join('\u0000');
  for (const shard of shards) {
    const samples = shard.timingSamples
      .filter(
        (sample) =>
          sample.targetCapacity === target.capacity &&
          (shard.behavior !== 'worker-based' || sample.workerGroup === activeWorkerGroup)
      )
      .slice(-5);
    shard.timingSamples = samples;
    shard.averageDurationMs = samples.length
      ? samples.reduce((total, sample) => total + sample.durationMs, 0) / samples.length
      : null;
    shard.averageWorkerMs = samples.length
      ? samples.reduce(
          (total, sample) => total + sample.durationMs * sample.allocatedCapacity,
          0
        ) / samples.length
      : null;

    const newest = samples.at(-1);
    const previous = newest
      ? [...samples]
          .slice(0, -1)
          .reverse()
          .find((sample) => sample.allocatedCapacity !== newest.allocatedCapacity)
      : null;
    if (previous) {
      const newestInverseCapacity = 1 / newest.allocatedCapacity;
      const previousInverseCapacity = 1 / previous.allocatedCapacity;
      const parallelMs =
        (newest.durationMs - previous.durationMs) /
        (newestInverseCapacity - previousInverseCapacity);
      const serialMs = newest.durationMs - parallelMs * newestInverseCapacity;
      if (Number.isFinite(parallelMs) && parallelMs > 0 && Number.isFinite(serialMs) && serialMs >= 0)
        shard.timingModel = { serialMs, parallelMs };
    }
  }

  process.stdout.write(
    `Execution: ${mode}\n` +
      `Resource configuration: ${resources.configPath}\n` +
      `Controller/node: ${target.name} (${target.effectiveLogicalCpus} logical CPUs, ${target.threadPolicy} = ${target.capacity} thread slots)\n` +
      `Timing history: ${history.size ? `${history.size} matching job record(s)` : 'none; this run is the calibration run'}\n\n`
  );
  if (multiVmGithub) {
    for (const shard of shards) {
      const assignment = shard.assignedToTarget
        ? shard.executionFiles.length
          ? `${shard.executionFiles.length} file(s), estimated weight ${shard.estimatedWeight}`
          : 'whole job'
        : 'assigned to another GitHub VM';
      process.stdout.write(`[assignment] ${shard.job.name} -> ${target.id}: ${assignment}\n`);
    }
    process.stdout.write('\n');
  }
  for (const shard of shards) {
    if (!shard.job.when.length) continue;
    process.stdout.write(
      `[select] ${shard.job.name}: ${shard.selectedFiles.length} changed file${shard.selectedFiles.length === 1 ? '' : 's'} matched ${shard.job.when.join(', ')} against ${shard.job.compare}\n`
    );
  }
  if (shards.some((shard) => shard.job.when.length)) process.stdout.write('\n');

  const state = new Map(shards.map((shard) => [shard.job.name, 'pending']));
  const results = new Map();
  const running = new Map();
  for (const shard of shards) {
    if (shard.assignedToTarget) continue;
    state.set(shard.job.name, 'not-needed');
    results.set(shard.job.name, {
      shardId: shard.id,
      jobName: shard.job.name,
      command: shard.historyCommand,
      targetId: target.id,
      targetCapacity: target.capacity,
      allocatedCapacity: 0,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      status: 'not-needed',
      detail: 'assigned to another configured GitHub VM',
    });
  }
  for (const shard of shards) {
    if (state.get(shard.job.name) !== 'pending') continue;
    if (!shard.job.when.length || shard.selectedFiles.length) continue;
    state.set(shard.job.name, 'not-needed');
    results.set(shard.job.name, {
      shardId: shard.id,
      jobName: shard.job.name,
      command: shard.historyCommand,
      targetId: target.id,
      targetCapacity: target.capacity,
      allocatedCapacity: 0,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      status: 'not-needed',
      detail: 'no declared application paths changed',
    });
  }
  while ([...state.values()].some((status) => status === 'pending' || status === 'running')) {
    for (const shard of shards) {
      if (state.get(shard.job.name) !== 'pending') continue;
      const blockedBy = shard.job.after.find((dependency) =>
        ['failed', 'skipped', 'interrupted'].includes(state.get(dependency))
      );
      if (!blockedBy) continue;
      state.set(shard.job.name, 'skipped');
      results.set(shard.job.name, {
        shardId: shard.id,
        jobName: shard.job.name,
        command: shard.job.command,
        targetId: target.id,
        targetCapacity: target.capacity,
        allocatedCapacity: 0,
        startedAt: null,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        status: 'skipped',
        detail: `dependency ${blockedBy} did not pass`,
      });
    }

    if (signal.aborted) {
      if (running.size)
        await Promise.all([...running.values()].map((entry) => entry.promise));
      for (const shard of shards) {
        if (state.get(shard.job.name) !== 'pending') continue;
        state.set(shard.job.name, 'interrupted');
        results.set(shard.job.name, {
          shardId: shard.id,
          jobName: shard.job.name,
          command: shard.job.command,
          targetId: target.id,
          targetCapacity: target.capacity,
          allocatedCapacity: 0,
          startedAt: null,
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          status: 'interrupted',
          detail: 'Vroom was interrupted',
        });
      }
      break;
    }

    const ready = shards
      .filter(
        (shard) =>
          state.get(shard.job.name) === 'pending' &&
          shard.job.after.every((dependency) =>
            ['passed', 'not-needed'].includes(state.get(dependency))
          )
      )
      .sort(
        (left, right) =>
          (right.averageDurationMs ?? -1) - (left.averageDurationMs ?? -1) ||
          left.originalOrder - right.originalOrder
      );
    const runningEntries = [...running.values()];
    const runningExclusive = runningEntries.some((entry) => entry.exclusive);
    const readyExclusive = ready.find((shard) => shard.job.exclusive);
    let availableCapacity =
      target.capacity - runningEntries.reduce((total, entry) => total + entry.allocatedCapacity, 0);
    const starting = [];

    if (!runningExclusive && availableCapacity > 0) {
      if (readyExclusive) {
        if (!running.size)
          starting.push({ shard: readyExclusive, allocatedCapacity: target.capacity });
      } else {
        const singleProcess = ready.filter((shard) => shard.behavior !== 'worker-based');
        for (const shard of singleProcess) {
          if (availableCapacity < 1) break;
          starting.push({ shard, allocatedCapacity: 1 });
          availableCapacity -= 1;
        }
        const workerBased = ready.filter((shard) => shard.behavior === 'worker-based');
        if (availableCapacity <= workerBased.length) {
          for (let index = 0; index < workerBased.length && availableCapacity > 0; index += 1) {
            starting.push({ shard: workerBased[index], allocatedCapacity: 1 });
            availableCapacity -= 1;
          }
        } else if (
          workerBased.length > 0 &&
          workerBased.every(
            (shard) => Number.isFinite(shard.averageWorkerMs) && shard.averageWorkerMs > 0
          )
        ) {
          const allocations = workerBased.map((shard) => {
            return {
              shard,
              allocatedCapacity: 1,
            };
          });
          let unassignedCapacity = availableCapacity - allocations.length;
          while (unassignedCapacity > 0) {
            let bestIndex = 0;
            for (let index = 1; index < allocations.length; index += 1) {
              const candidate = allocations[index];
              const currentBest = allocations[bestIndex];
              const candidateDuration = candidate.shard.timingModel
                ? candidate.shard.timingModel.serialMs +
                  candidate.shard.timingModel.parallelMs / candidate.allocatedCapacity
                : candidate.shard.averageWorkerMs / candidate.allocatedCapacity;
              const bestDuration = currentBest.shard.timingModel
                ? currentBest.shard.timingModel.serialMs +
                  currentBest.shard.timingModel.parallelMs / currentBest.allocatedCapacity
                : currentBest.shard.averageWorkerMs / currentBest.allocatedCapacity;
              if (candidateDuration > bestDuration) bestIndex = index;
            }
            allocations[bestIndex].allocatedCapacity += 1;
            unassignedCapacity -= 1;
          }
          for (const allocation of allocations)
            starting.push({
              shard: allocation.shard,
              allocatedCapacity: allocation.allocatedCapacity,
            });
          availableCapacity = 0;
        } else {
          for (let index = 0; index < workerBased.length && availableCapacity > 0; index += 1) {
            const shard = workerBased[index];
            const remainingWorkers = workerBased.length - index;
            const allocatedCapacity = Math.max(
              1,
              Math.floor(availableCapacity / remainingWorkers)
            );
            starting.push({ shard, allocatedCapacity });
            availableCapacity -= allocatedCapacity;
          }
        }
      }
    }

    for (const { shard, allocatedCapacity } of starting) {
      state.set(shard.job.name, 'running');
      let executionCommand = shard.job.command;
      if (shard.executionFiles.length)
        executionCommand += ` ${shard.executionFiles.join(' ')}`;
      if (shard.behavior === 'worker-based') {
        if (/\b(vitest|jest)\b/i.test(shard.resolvedCommand) && !/--maxWorkers(?:=|\s)/i.test(executionCommand))
          executionCommand += ` --maxWorkers=${allocatedCapacity}`;
        else if (/\bplaywright\s+test\b/i.test(shard.resolvedCommand) && !/--workers(?:=|\s)/i.test(executionCommand))
          executionCommand += ` --workers=${allocatedCapacity}`;
        else if (/\bnode\s+--test\b/i.test(shard.resolvedCommand) && !/--test-concurrency(?:=|\s)/i.test(executionCommand))
          executionCommand += ` --test-concurrency=${allocatedCapacity}`;
      }
      process.stdout.write(
        `[start] ${shard.job.name} -> ${target.id} (${allocatedCapacity} thread slot${allocatedCapacity === 1 ? '' : 's'})\n`
      );

      const execution = execute({
        applicationRoot: plan.applicationRoot,
        executionCommand,
        shard,
        target,
        allocatedCapacity,
        signal,
      });

      const tracked = execution.then((result) => {
        results.set(shard.job.name, result);
        state.set(shard.job.name, result.status);
        running.delete(shard.job.name);
        return result;
      });
      running.set(shard.job.name, {
        promise: tracked,
        allocatedCapacity,
        exclusive: shard.job.exclusive,
      });
    }

    if (running.size)
      await Promise.race([...running.values()].map((entry) => entry.promise));
    else if ([...state.values()].some((status) => status === 'pending'))
      throw new Error('No runnable jobs remain; check workload dependencies and resource capacity');
  }

  const orderedResults = shards.map((shard) => results.get(shard.job.name));
  const timingOutcome = await TimingResults({
    action: 'save',
    applicationRoot: plan.applicationRoot,
    workload: plan.workload,
    profiles: activeProfiles,
    selectedJobNames,
    mode,
    target,
    resources,
    results: orderedResults,
    history,
    githubReturn,
  });
  return {
    resources,
    results: timingOutcome.results,
    receiptPaths: timingOutcome.receiptPaths,
    timingLogPaths: timingOutcome.timingLogPaths,
  };
}

// J. runVroom
// Owns end-to-end coordination and the final result. It connects functions A-I,
// installs and removes interruption and disconnect handlers, prints the final
// per-job summary and timing-log location, and returns the process exit code for
// success, failure, or interruption. It does not duplicate functions A-I.
async function runVroom() {
  const options = CliInterface(process.argv.slice(2));
  if (!options) return 0;

  const configuration = await loadApplicationConfiguration(
    options.applicationRoot,
    options.workload
  );
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  process.on('SIGHUP', interrupt);

  try {
    const outcome = await Scheduler(configuration, options.executionMode, controller.signal, {
      githubPlan: options.githubPlan,
    });
    if (outcome.plannedOnly) {
      process.stdout.write(
        `\nVroom GitHub plan: ${outcome.resources.targets.length} configured VM(s)\n`
      );
      return 0;
    }
    process.stdout.write(`\nVroom result: ${configuration.workload}\n`);
    let passed = true;
    for (const result of outcome.results) {
      if (!['passed', 'not-needed'].includes(result.status)) passed = false;
      const duration = result.durationMs
        ? ` (${(Math.round(result.durationMs / 100) / 10).toFixed(1)}s)`
        : '';
      process.stdout.write(
        `  ${result.status.padEnd(11)} ${result.jobName}${duration}` +
          `${result.detail ? ` - ${result.detail}` : ''}\n`
      );
    }
    if (!outcome.timingLogPaths.length)
      process.stdout.write('Timing log: not created because no jobs were selected\n');
    else if (outcome.timingLogPaths.length === 1)
      process.stdout.write(`Timing log: ${outcome.timingLogPaths[0]}\n`);
    else {
      process.stdout.write('Timing logs:\n');
      for (const timingLogPath of outcome.timingLogPaths)
        process.stdout.write(`  ${timingLogPath}\n`);
    }
    process.stdout.write(`\n${passed ? 'PASSED' : 'FAILED'}\n`);
    if (controller.signal.aborted) return 130;
    return passed ? 0 : 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    process.off('SIGHUP', interrupt);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runVroom();
  } catch (error) {
    process.stderr.write(`Vroom error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { TimingResults };
