#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_FILE = 'vroom-app.cfg';
const RESOURCE_FILE = 'vroom.cfg';
const TIMING_LOG_LIMIT = 5;
const DEFAULT_WORKLOAD = 'dev';
const VROOM_ROOT = dirname(fileURLToPath(import.meta.url));

// A. CliInterface
// Owns the user-facing command syntax. It prints help when requested, validates
// the registered application id and optional workload arguments, applies dev
// as the default workload, and selects local, GitHub execution, or GitHub
// plan-only mode. It does not read configuration or execute work.
function CliInterface(args) {
  const help = `Usage: vroom <application-id> [workload] <--local | --github | --github-plan>

Resolves <application-id> through ${RESOURCE_FILE}, then runs the selected
workload from that application's owned configuration.
The workload defaults to "${DEFAULT_WORKLOAD}" when omitted.
Use --local to select Mode 1 execution on the current computer.
Use --github only inside GitHub Actions to select Mode 2 execution.
Use --github-plan inside GitHub Actions to emit the configured node matrix
without executing the workload.

Examples:
  vroom my-app --local
  vroom my-app compile --local
  vroom my-app pre-pr --github-plan
  vroom my-app pre-pr --github
`;

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(help);
    return null;
  }
  // A future installer function will own argument-free startup. Until that
  // function is implemented, no arguments remain an explicit error rather
  // than silently selecting Mode 1 or performing a partial installation.
  const supportedModes = new Set(['--local', '--github', '--github-plan']);
  const modeFlags = args.filter((argument) => supportedModes.has(argument));
  const positional = args.filter((argument) => !supportedModes.has(argument));
  if (
    args.some((argument) => argument.startsWith('-') && !supportedModes.has(argument)) ||
    modeFlags.length !== 1 ||
    positional.length < 1 ||
    positional.length > 2
  )
    throw new Error(`Invalid arguments.\n\n${help}`);

  const applicationId = positional[0].toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(applicationId))
    throw new Error(`Invalid application id: ${applicationId}`);

  const workload = positional[1] ?? DEFAULT_WORKLOAD;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(workload))
    throw new Error(`Invalid workload name: ${workload}`);

  const selectedMode = modeFlags[0];
  const githubPlan = selectedMode === '--github-plan';
  const executionMode = selectedMode === '--local' ? 'local' : 'github';
  const githubReturn = Boolean(process.env.VROOM_GITHUB_RETURN_RUN_ID);
  if (
    executionMode === 'github' &&
    process.env.GITHUB_ACTIONS !== 'true' &&
    (githubPlan || !githubReturn)
  )
    throw new Error(
      githubPlan
        ? '--github-plan requires GitHub Actions'
        : '--github requires GitHub Actions or a completed GitHub return'
    );

  return {
    applicationId,
    workload,
    executionMode,
    githubPlan,
    githubReturn,
  };
}

// B. loadApplicationConfiguration
// Owns application configuration intake. It confirms the application folder,
// reads vroom-app.cfg, parses its workload sections and job metadata, selects
// the requested workload, creates the job records, validates application-owned
// file lists or application-owned file-discovery commands, provider-native
// workflow results, changed-file rules, and fixed non-secret job environments,
// and rejects missing dependencies or dependency cycles. It does not decide
// execution order or run jobs.
async function loadApplicationConfiguration(
  applicationRoot,
  workload,
  configurationFile = CONFIG_FILE,
  discoverFiles = true
) {
  const applicationStats = await stat(applicationRoot).catch((error) => {
    if (error.code === 'ENOENT') throw new Error(`Application folder does not exist: ${applicationRoot}`);
    throw error;
  });
  if (!applicationStats.isDirectory()) throw new Error(`Application path is not a folder: ${applicationRoot}`);
  const configPath = join(applicationRoot, configurationFile);
  const source = await readFile(configPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') throw new Error(`Missing application configuration: ${configPath}`);
    throw error;
  });
  const sections = new Map();
  let currentSection = null;
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.trim();
    const lineNumber = index + 1;
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = /^\[([a-z0-9][a-z0-9-]*)\]$/i.exec(line);
    if (sectionMatch) {
      if (sections.has(sectionMatch[1])) throw new Error(`${configPath}:${lineNumber}: duplicate [${sectionMatch[1]}] section`);
      currentSection = new Map();
      sections.set(sectionMatch[1], currentSection);
      continue;
    }
    if (!currentSection) throw new Error(`${configPath}:${lineNumber}: setting appears before a section`);
    const separator = original.indexOf('=');
    if (separator < 1) throw new Error(`${configPath}:${lineNumber}: expected name = value`);
    const key = original.slice(0, separator).trim();
    const value = original.slice(separator + 1).trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(key)) throw new Error(`${configPath}:${lineNumber}: invalid setting name: ${key}`);
    if (!value) throw new Error(`${configPath}:${lineNumber}: ${key} has no value`);
    if (currentSection.has(key)) throw new Error(`${configPath}:${lineNumber}: duplicate setting: ${key}`);
    currentSection.set(key, { value, lineNumber });
  }
  if (!sections.size) throw new Error(`${configPath}: no workload sections found`);
  const selected = sections.get(workload);
  if (!selected) throw new Error(`Workload [${workload}] is not defined in ${configPath}. Available: ${[...sections.keys()].join(', ')}`);

  const csv = (entry) => entry?.value.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const profileEntry = selected.get('profiles');
  const profileNames = csv(profileEntry);
  if (new Set(profileNames).size !== profileNames.length || profileNames.some((name) => !/^[a-z0-9][a-z0-9-]*$/i.test(name)))
    throw new Error(`${configPath}:${profileEntry?.lineNumber}: profiles must be unique names`);
  const profiles = profileNames.map((name) => {
    const key = `profile.${name}.jobs`;
    const entry = selected.get(key);
    if (!entry) throw new Error(`${configPath}:${profileEntry.lineNumber}: profile ${name} requires ${key}`);
    const jobs = csv(entry);
    if (!jobs.length || new Set(jobs).size !== jobs.length) throw new Error(`${configPath}:${entry.lineNumber}: ${key} must list unique jobs`);
    return { name, jobs };
  });
  const knownProfileSettings = new Set([
    'profiles',
    ...profiles.map((profile) => `profile.${profile.name}.jobs`),
  ]);
  for (const [key, entry] of selected) {
    if (key.startsWith('profile.') && !knownProfileSettings.has(key))
      throw new Error(`${configPath}:${entry.lineNumber}: unknown profile setting: ${key}`);
  }
  const records = new Map();
  for (const [key, entry] of selected) {
    if (key === 'profiles' || key.startsWith('profile.')) continue;
    const metadataMatch =
      /^(.+)\.(kind|after|exclusive|when|compare|files|files-command|env|provider-results)$/.exec(key);
    const jobName = metadataMatch ? metadataMatch[1] : key;
    if (!records.has(jobName)) records.set(jobName, { name: jobName, metadata: {} });
    const record = records.get(jobName);
    if (metadataMatch) record.metadata[metadataMatch[2]] = entry;
    else record.command = entry;
  }

  const jobs = [];
  for (const record of records.values()) {
    if (!record.command) throw new Error(`${configPath}: metadata exists for missing job ${record.name}`);
    const kind = record.metadata.kind?.value ?? 'check';
    if (!['check', 'prepare', 'build', 'post-build'].includes(kind)) throw new Error(`${configPath}: invalid kind for ${record.name}: ${kind}`);
    const exclusiveText = record.metadata.exclusive?.value ?? 'false';
    if (!['true', 'false'].includes(exclusiveText)) throw new Error(`${configPath}: ${record.name}.exclusive must be true or false`);
    const dependencies = csv(record.metadata.after);
    const when = csv(record.metadata.when).map((pattern) => pattern.replace(/\\/g, '/'));
    if (when.some((pattern) => pattern.startsWith('/') || pattern.includes('..') || (pattern.includes('*') && !pattern.endsWith('/**'))))
      throw new Error(`${configPath}: ${record.name}.when supports relative paths and trailing /** only`);
    let files = csv(record.metadata.files).map((file) => file.replace(/\\/g, '/'));
    const filesCommand = record.metadata['files-command']?.value ?? null;
    if (filesCommand && files.length) throw new Error(`${configPath}: ${record.name} cannot use files and files-command`);
    if (filesCommand && discoverFiles) {
      const discovery = spawnSync(filesCommand, {
        cwd: applicationRoot,
        env: process.env,
        encoding: 'utf8',
        shell: true,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (discovery.error) throw new Error(`${record.name}.files-command could not start: ${discovery.error.message}`);
      if (discovery.status !== 0) throw new Error(`${record.name}.files-command failed: ${(discovery.stderr ?? '').trim() || `exit ${discovery.status}`}`);
      files = [...new Set((discovery.stdout ?? '')
        .split(/\r?\n/)
        .map((file) => file.trim())
        .filter(Boolean)
        .map((file) => {
          const normalized = file.replace(/\\/g, '/');
          return isAbsolute(file)
            ? relative(applicationRoot, resolve(file)).replace(/\\/g, '/')
            : normalized;
        }))];
      if (!files.length) throw new Error(`${record.name}.files-command returned no files`);
    }
    if (files.some((file) => file.startsWith('/') || file.includes('..') || file.includes('*') || !/^[a-z0-9_./@+-]+$/i.test(file)))
      throw new Error(`${configPath}: ${record.name} supports relative file or folder paths only`);
    const compare = record.metadata.compare?.value ?? null;
    if (compare && (!when.length || !/^[a-z0-9][a-z0-9._/@+-]*$/i.test(compare))) throw new Error(`${configPath}: invalid compare value for ${record.name}`);
    const environment = {};
    for (const assignment of csv(record.metadata.env)) {
      const separator = assignment.indexOf('=');
      const name = assignment.slice(0, separator).trim();
      const value = assignment.slice(separator + 1).trim();
      if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !value || name.startsWith('VROOM_') || Object.hasOwn(environment, name))
        throw new Error(`${configPath}: invalid ${record.name}.env assignment: ${assignment}`);
      environment[name] = value;
    }
    const providerMatch = /^workflow\s+([^\s]+)\s+([a-z0-9][a-z0-9_-]*)$/i.exec(
      record.command.value
    );
    const providerResultNames = csv(record.metadata['provider-results']);
    if (providerMatch) {
      const workflowPath = providerMatch[1].replace(/\\/g, '/');
      if (workflowPath.includes('..') || !/^\.github\/workflows\/[a-z0-9_./@+-]+\.ya?ml$/i.test(workflowPath) || !providerResultNames.length || new Set(providerResultNames).size !== providerResultNames.length)
        throw new Error(`${configPath}: invalid provider-native job ${record.name}`);
      if (files.length || filesCommand || Object.keys(environment).length)
        throw new Error(`${configPath}: provider-native job ${record.name} cannot declare files or environment`);
    } else if (providerResultNames.length) throw new Error(`${configPath}: ${record.name}.provider-results requires a workflow command`);
    jobs.push({
      name: record.name,
      command: record.command.value,
      behavior: record.command.value.includes('{threads}') ? 'worker-based' : 'single-process',
      kind,
      after: dependencies,
      exclusive: exclusiveText === 'true',
      when,
      compare: when.length ? compare ?? 'main' : null,
      files,
      environment,
      provider: providerMatch
        ? {
            name: 'github-actions',
            workflow: providerMatch[1].replace(/\\/g, '/'),
            job: providerMatch[2],
            results: providerResultNames,
          }
        : null,
    });
  }

  if (!jobs.length) throw new Error(`Workload [${workload}] contains no jobs`);
  const knownNames = new Set(jobs.map((job) => job.name));
  const profileByJob = new Map();
  for (const profile of profiles) {
    for (const jobName of profile.jobs) {
      if (!knownNames.has(jobName) || profileByJob.has(jobName)) throw new Error(`${configPath}: invalid profile job ${jobName}`);
      profileByJob.set(jobName, profile.name);
    }
  }
  for (const job of jobs) {
    for (const dependency of job.after) {
      if (dependency === job.name || !knownNames.has(dependency)) throw new Error(`${configPath}: invalid dependency ${job.name} -> ${dependency}`);
    }
  }
  const remainingDependencies = new Map(jobs.map((job) => [job.name, job.after.length]));
  const readyNames = jobs.filter((job) => !job.after.length).map((job) => job.name);
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
  if (visited !== jobs.length) throw new Error(`${configPath}: dependency cycle in [${workload}]`);
  return {
    applicationRoot,
    configPath,
    developerDataRoot: join(dirname(configPath), 'dev-user-data'),
    workload,
    profiles,
    jobs,
  };
}

// C. loadVroomConfiguration
// Owns every task involving Vroom's root vroom.cfg. It reads, parses, validates,
// and normalizes the supported-application registry plus local, GitHub,
// controller, and Mode 3 node settings so the rest of Vroom receives
// configuration data without handling the file itself. Future vroom.cfg
// features remain contained in this function.
async function loadVroomConfiguration() {
  const configPath = join(VROOM_ROOT, RESOURCE_FILE);
  const source = await readFile(configPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') throw new Error(`Missing Vroom resource configuration: ${configPath}`);
    throw error;
  });
  const sections = new Map();
  let section = null;
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = /^\[([a-z0-9][a-z0-9 -]*)\]$/i.exec(line);
    if (sectionMatch) {
      const name = sectionMatch[1].trim().toLowerCase().replace(/\s+/g, ' ');
      if (sections.has(name)) throw new Error(`${configPath}:${index + 1}: duplicate [${name}] section`);
      section = new Map();
      sections.set(name, section);
      continue;
    }
    if (!section) throw new Error(`${configPath}:${index + 1}: setting appears before a section`);
    const separator = original.indexOf('=');
    if (separator < 1) throw new Error(`${configPath}:${index + 1}: expected name = value`);
    const key = original.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = original.slice(separator + 1).trim();
    if (!value) throw new Error(`${configPath}:${index + 1}: ${key} has no value`);
    if (section.has(key)) throw new Error(`${configPath}:${index + 1}: duplicate setting: ${key}`);
    section.set(key, { value, lineNumber: index + 1 });
  }

  for (const required of ['local', 'github'])
    if (!sections.has(required)) throw new Error(`${configPath}: missing [${required}] section`);
  const readInteger = (entry, label, maximum = 256) => {
    const value = Number(entry?.value);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${configPath}: ${label} must be 1-${maximum}`);
    return value;
  };
  const readBoolean = (entry, label) => {
    if (!entry || !['true', 'false'].includes(entry.value.toLowerCase())) throw new Error(`${configPath}: ${label} must be true or false`);
    return entry.value.toLowerCase() === 'true';
  };
  const readIdentity = (entry, label, allowZero = false) => {
    const value = entry?.value;
    if (!value || !/^[0-9]{3}$/.test(value) || (!allowZero && value === '000'))
      throw new Error(`${configPath}: ${label} must use three digits ${allowZero ? 'from 000 through 999' : 'from 001 through 999'}`);
    return value;
  };
  const readTargetId = (entry, label) => {
    const value = entry?.value;
    if (!value || !/^[a-z0-9][a-z0-9-]*$/i.test(value))
      throw new Error(`${configPath}: ${label} must be a simple stable name`);
    return value;
  };
  const readThreadPolicy = (expressionEntry, minimumEntry, label) => {
    const expression = expressionEntry?.value.toLowerCase().replace(/\s+/g, '');
    if (!expression || !/^(?:[1-9][0-9]*|(?:[1-9][0-9]*)?n(?:[+-][0-9]+)?)$/.test(expression)) throw new Error(`${configPath}: invalid ${label} thread policy`);
    return { expression, minimum: readInteger(minimumEntry, `${label} minimum thread count`) };
  };

  const local = sections.get('local');
  const github = sections.get('github');
  const targetIds = {
    local: readTargetId(local.get('target id'), 'local target id'),
    github: readTargetId(github.get('target id'), 'github target id'),
  };
  const applications = new Map();
  for (const [name, application] of sections) {
    const match = /^application ([a-z0-9][a-z0-9-]*)$/.exec(name);
    if (!match) continue;
    const applicationName = application.get('name')?.value;
    const applicationPath = application.get('path')?.value;
    const configurationFile = application.get('configuration')?.value;
    if (!applicationName || !applicationPath || !configurationFile) throw new Error(`${configPath}: [${name}] requires name, path, and configuration`);
    applications.set(match[1], {
      id: match[1],
      name: applicationName,
      path: applicationPath,
      githubPath: application.get('github path')?.value ?? applicationPath,
      configurationFile,
    });
  }
  if (!applications.size) throw new Error(`${configPath}: no [application <id>] sections found`);

  const federations = new Map();
  for (const [name, settings] of sections) {
    const match = /^federation ([0-9]{3})$/.exec(name);
    if (!match) continue;
    const federationId = readIdentity({ value: match[1] }, `${name} id`);
    const federationName = settings.get('name')?.value;
    const type = settings.get('type')?.value.toLowerCase();
    if (!federationName) throw new Error(`${configPath}: [${name}] requires name`);
    if (type !== 'federation') throw new Error(`${configPath}: [${name}] type must be federation`);
    federations.set(federationId, {
      id: federationId,
      name: federationName,
      type,
      targetId: readTargetId(settings.get('target id'), `${name} target id`),
      controllers: [],
      sharedAuthenticationKey: sections.get(`${name} security`)?.get('shared authentication key')?.value ?? null,
    });
  }
  if (!federations.size) throw new Error(`${configPath}: no [federation <id>] sections found`);

  const controllers = new Map();
  for (const [name, settings] of sections) {
    const match = /^federation ([0-9]{3}) controller ([0-9]{3})$/.exec(name);
    if (!match) continue;
    const federationId = readIdentity({ value: match[1] }, `${name} federation id`);
    const controllerId = readIdentity({ value: match[2] }, `${name} controller id`);
    const federation = federations.get(federationId);
    if (!federation) throw new Error(`${configPath}: [${name}] references an unknown federation`);
    if (readIdentity(settings.get('federation id'), `${name} federation id`) !== federationId)
      throw new Error(`${configPath}: [${name}] federation id does not match its section`);
    if (readIdentity(settings.get('controller id'), `${name} controller id`) !== controllerId)
      throw new Error(`${configPath}: [${name}] controller id does not match its section`);
    if (readIdentity(settings.get('node id'), `${name} controller node id`, true) !== '000')
      throw new Error(`${configPath}: [${name}] must reserve node id 000 for its controller`);
    const clusterName = settings.get('cluster name')?.value;
    const clusterType = settings.get('cluster type')?.value.toLowerCase();
    const computerName = settings.get('computer name')?.value;
    const githubUsername = settings.get('github username')?.value;
    const ipAddress = settings.get('ip address')?.value;
    const cpuName = settings.get('cpu name')?.value;
    if (!clusterName || !computerName || !ipAddress || !cpuName)
      throw new Error(`${configPath}: [${name}] requires cluster, computer, network, and CPU identity`);
    if (!['local', 'federation'].includes(clusterType))
      throw new Error(`${configPath}: [${name}] cluster type must be local or federation`);
    const controller = {
      id: `federation-${federationId}-controller-${controllerId}`,
      federationId,
      controllerId,
      nodeId: '000',
      executionNodeId: `federation-${federationId}-controller-${controllerId}-node-000`,
      clusterName,
      clusterType,
      targetId: readTargetId(settings.get('target id'), `${name} target id`),
      githubUsername,
      computerName,
      ipAddress,
      port: readInteger(settings.get('port'), `${name} port`, 65_535),
      cpuName,
      availableThreads: readInteger(settings.get('available threads'), `${name} available threads`),
      threadPolicy: readThreadPolicy(settings.get('threads'), settings.get('minimum thread count'), name),
      nodes: [],
    };
    controllers.set(`${federationId}:${controllerId}`, controller);
    federation.controllers.push(controller);
  }
  if (!controllers.size) throw new Error(`${configPath}: no federation controller sections found`);

  for (const [name, settings] of sections) {
    const match = /^federation ([0-9]{3}) controller ([0-9]{3}) node ([0-9]{3})$/.exec(name);
    if (!match) continue;
    const federationId = readIdentity({ value: match[1] }, `${name} federation id`);
    const controllerId = readIdentity({ value: match[2] }, `${name} controller id`);
    const nodeId = readIdentity({ value: match[3] }, `${name} node id`);
    const controller = controllers.get(`${federationId}:${controllerId}`);
    if (!controller) throw new Error(`${configPath}: [${name}] references an unknown controller`);
    if (readIdentity(settings.get('controller id'), `${name} controller id`) !== controllerId)
      throw new Error(`${configPath}: [${name}] controller id does not match its section`);
    if (readIdentity(settings.get('node id'), `${name} node id`) !== nodeId)
      throw new Error(`${configPath}: [${name}] node id does not match its section`);
    controller.nodes.push({
      id: `federation-${federationId}-controller-${controllerId}-node-${nodeId}`,
      federationId,
      controllerId,
      nodeId,
      enabled: readBoolean(settings.get('enabled'), `${name} enabled`),
      name: settings.get('computer name')?.value ?? `Node ${nodeId}`,
      ipAddress: settings.get('ip address')?.value ?? null,
      port: readInteger(settings.get('port'), `${name} port`, 65_535),
      cpuName: settings.get('cpu name')?.value ?? null,
      availableThreads: readInteger(settings.get('available threads'), `${name} available threads`),
      threadPolicy: readThreadPolicy(settings.get('threads'), settings.get('minimum thread count'), name),
    });
  }
  for (const federation of federations.values()) {
    federation.controllers.sort((left, right) => left.controllerId.localeCompare(right.controllerId));
    if (!federation.controllers.length)
      throw new Error(`${configPath}: federation ${federation.id} has no controllers`);
    for (const controller of federation.controllers)
      controller.nodes.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  }
  const federationList = [...federations.values()].sort((left, right) => left.id.localeCompare(right.id));
  const selectedFederation = federationList.length === 1 ? federationList[0] : null;

  return {
    configPath,
    applications,
    local: {
      targetId: targetIds.local,
      availableThreads: readInteger(local.get('available threads'), 'local available threads'),
      threadPolicy: readThreadPolicy(local.get('threads'), local.get('minimum thread count'), 'local'),
    },
    github: {
      targetId: targetIds.github,
      nodes: readInteger(github.get('nodes'), 'github nodes', 20),
      availableThreadsPerNode: readInteger(github.get('available threads per node'), 'github available threads per node'),
      threadPolicy: readThreadPolicy(github.get('threads'), github.get('minimum thread count'), 'github'),
    },
    cluster: {
      targetId: selectedFederation?.targetId ?? null,
      federationId: selectedFederation?.id ?? null,
      name: selectedFederation?.name ?? null,
      type: selectedFederation?.type ?? null,
      controllers: selectedFederation?.controllers ?? [],
      federations: federationList,
    },
  };
}

// D. CpuThreadPlanning
// Owns CPU and thread planning for local, GitHub, and cluster execution. It
// uses only configured node resources and returns one generic weighted node
// map from the performance samples supplied by TimingResults. Shared GitHub nodes keep
// equal configured weights because provider-load variation is noise. Scheduler
// owns all work assignment.
async function CpuThreadPlanning(mode, configuration, performanceSamples = new Map()) {
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
  const median = (values) => {
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };

  const nodes = [];
  if (mode === 'local') {
    const logicalCpus = configuration.local.availableThreads;
    const policy = applyThreadPolicy(configuration.local.threadPolicy, logicalCpus);
    nodes.push({
      id: 'local',
      name: hostname(),
      role: 'controller-node',
      source: 'local',
      availableLogicalCpus: logicalCpus,
      threadPolicy: policy.expression,
      capacity: policy.capacity,
    });
  } else if (mode === 'github') {
    const nodeCount = configuration.github.nodes;
    const logicalCpus = configuration.github.availableThreadsPerNode;
    const policy = applyThreadPolicy(configuration.github.threadPolicy, logicalCpus);
    for (let number = 1; number <= nodeCount; number += 1) {
      nodes.push({
        id: `github-node-${String(number).padStart(2, '0')}`,
        name: `GitHub node ${String(number).padStart(2, '0')}`,
        role: 'node',
        source: 'github',
        availableLogicalCpus: logicalCpus,
        threadPolicy: policy.expression,
        capacity: policy.capacity,
      });
    }
  } else {
    if (!configuration.cluster.federationId || !configuration.cluster.controllers.length)
      throw new Error(`${configuration.configPath}: cluster mode needs one configured federation`);
    for (const controller of configuration.cluster.controllers) {
      const logicalCpus = controller.availableThreads;
      const controllerPolicy = applyThreadPolicy(controller.threadPolicy, logicalCpus);
      nodes.push({
        id: controller.executionNodeId,
        name: controller.computerName,
        role: 'controller-node',
        source: 'cluster',
        federationId: controller.federationId,
        controllerId: controller.controllerId,
        nodeId: controller.nodeId,
        availableLogicalCpus: logicalCpus,
        threadPolicy: controllerPolicy.expression,
        capacity: controllerPolicy.capacity,
      });
      for (const node of controller.nodes.filter((candidate) => candidate.enabled)) {
        const nodeLogicalCpus = node.availableThreads;
        const policy = applyThreadPolicy(node.threadPolicy, nodeLogicalCpus);
        nodes.push({
          id: node.id,
          name: node.name,
          role: 'node',
          source: 'cluster',
          federationId: node.federationId,
          controllerId: node.controllerId,
          nodeId: node.nodeId,
          availableLogicalCpus: nodeLogicalCpus,
          threadPolicy: policy.expression,
          capacity: policy.capacity,
        });
      }
    }
  }

  const nodeWeights = new Map(nodes.map((node) => [node.id, 1]));
  if (mode !== 'github') {
    const measuredPerformance = new Map();
    for (const resourceNode of nodes) {
      const samples = (performanceSamples.get(resourceNode.id) ?? [])
        .slice(-5)
        .sort((left, right) => left - right);
      measuredPerformance.set(resourceNode.id, median(samples));
    }
    const measured = [...measuredPerformance.values()]
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
    const baseline = median(measured) ?? 1;
    for (const resourceNode of nodes) {
      const performance = measuredPerformance.get(resourceNode.id);
      const relativeWeight = performance ? performance / baseline : 1;
      nodeWeights.set(
        resourceNode.id,
        Math.round(Math.min(4, Math.max(0.25, relativeWeight)) * 1000) / 1000
      );
    }
  }
  for (const node of nodes) {
    node.performanceWeight = nodeWeights.get(node.id) ?? 1;
    node.weightedCapacity = node.capacity * node.performanceWeight;
  }

  return {
    configPath: configuration.configPath,
    controllerId:
      mode === 'local'
        ? 'local'
        : mode === 'cluster'
          ? `federation-${configuration.cluster.federationId}`
          : 'github',
    nodes,
    totalCapacity: nodes.reduce((total, node) => total + node.capacity, 0),
  };
}

// E. Controller
// Owns the boundary between Scheduler's node assignments and the environment
// that delivers those assignments. It never selects work, balances capacity,
// or becomes another scheduler. Local mode calls ExecutionNode in this process.
// In GitHub mode the thin workflow has already provisioned each hosted VM and
// started Vroom; Controller validates the GitHub node identity and starts only
// that node's assigned work. Mode 3 will extend this function so the controller
// contacts enrolled cluster nodes, starts Vroom with an immutable assignment,
// tracks delivery, cancellation, and node loss, and receives the returned
// disposition. The remote Mode 3 transport is deliberately not implemented
// until its contract is recovered and approved from DB-3.
async function Controller({ mode, request }) {
  const action = request.action ?? 'execute';
  if (mode === 'local') {
    if (action !== 'execute') throw new Error(`Controller ${action} requires a provider`);
    return ExecutionNode({ ...request, mode, executionContext: null });
  }
  if (mode === 'cluster')
    throw new Error('Controller cluster dispatch is reserved for Mode 3 and is not implemented');
  if (mode !== 'github') throw new Error(`Controller received unsupported execution mode: ${mode}`);

  const returnedRunId = process.env.VROOM_GITHUB_RETURN_RUN_ID?.trim();
  if (action === 'context' && returnedRunId) {
    const repository = process.env.VROOM_GITHUB_RETURN_REPOSITORY?.trim();
    const token = process.env.VROOM_GITHUB_TOKEN?.trim();
    if (!repository || !token)
      throw new Error('Completed GitHub return requires repository and token values');
    const runAttempt = process.env.VROOM_GITHUB_RETURN_ATTEMPT?.trim() || '1';
    return {
      phase: 'reconcile', plan: null,
      executionResult: process.env.VROOM_GITHUB_EXECUTION_RESULT ?? null,
      artifactReturn: {
        repository, runId: returnedRunId, runAttempt, token, allowEmpty: true,
        artifactPrefix: `vroom-${request.applicationId}-${request.targetId}-${request.workload}-${returnedRunId}-${runAttempt}-reconciled`,
      },
    };
  }
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error(`Controller ${action} requires GitHub Actions`);

  const context = {
    provider: 'github-actions',
    repository: process.env.GITHUB_REPOSITORY?.trim(),
    runId: process.env.GITHUB_RUN_ID?.trim(),
    runAttempt: process.env.GITHUB_RUN_ATTEMPT?.trim(),
    commitSha: process.env.GITHUB_SHA?.trim(),
    workflow: process.env.GITHUB_WORKFLOW ?? '',
  };
  if (!context.repository || !context.runId || !context.runAttempt || !context.commitSha)
    throw new Error('GitHub environment is missing repository, run, attempt, or commit identity');

  if (action === 'publish-plan') {
    const outputPath = process.env.GITHUB_OUTPUT?.trim();
    if (!outputPath) throw new Error('GitHub planning requires GITHUB_OUTPUT');
    const plan = {
      schema: 'vroom-plan-v1', ...context,
      applicationId: request.applicationId, targetId: request.targetId,
      workload: request.workload, nodes: request.nodes,
      assignments: request.assignments, providerUnits: request.providerUnits,
    };
    const matrix = { node: request.nodes.map((node) => node.id) };
    await appendFile(outputPath,
      `matrix=${JSON.stringify(matrix)}\nplan=${JSON.stringify(plan)}\n`, 'utf8');
    return { matrix };
  }

  if (action === 'context') {
    let plan;
    try {
      plan = JSON.parse(process.env.VROOM_GITHUB_PLAN ?? '');
    } catch {
      throw new Error('GitHub execution requires a valid Vroom assignment plan');
    }
    if (
      plan.schema !== 'vroom-plan-v1' ||
      plan.provider !== context.provider ||
      plan.repository !== context.repository ||
      String(plan.runId) !== context.runId ||
      String(plan.runAttempt) !== context.runAttempt ||
      plan.commitSha !== context.commitSha ||
      plan.applicationId !== request.applicationId ||
      plan.targetId !== request.targetId ||
      plan.workload !== request.workload ||
      !Array.isArray(plan.nodes) ||
      !Array.isArray(plan.assignments) ||
      !Array.isArray(plan.providerUnits)
    )
      throw new Error('GitHub received an invalid or foreign Vroom assignment plan');
    return {
      phase: process.env.VROOM_GITHUB_RECONCILE === 'true' ? 'reconcile' : 'execute', plan,
      nodeId: process.env.VROOM_NODE_ID?.trim() || null,
      executionResult: process.env.VROOM_GITHUB_EXECUTION_RESULT ?? null,
      artifactReturn: {
        ...context, token: process.env.VROOM_GITHUB_TOKEN?.trim(), allowEmpty: true,
      },
    };
  }

  if (action !== 'execute') throw new Error(`Controller received unsupported action: ${action}`);
  if (!process.env.GITHUB_JOB || !process.env.VROOM_NODE_ID)
    throw new Error('GitHub node execution requires GITHUB_JOB and VROOM_NODE_ID');
  if (process.env.VROOM_NODE_ID !== request.node.id)
    throw new Error(`GitHub node identity does not match assignment ${request.node.id}`);
  if (
    !request.assignment ||
    request.assignment.shardId !== request.shard.id ||
    request.assignment.jobName !== request.shard.job.name ||
    request.assignment.nodeId !== request.node.id ||
    request.assignment.nodeCapacity !== request.node.capacity
  )
    throw new Error(`GitHub node received an invalid planned assignment for ${request.shard.id}`);
  return ExecutionNode({ ...request, mode,
    executionContext: { ...context, executionTarget: request.targetId } });
}

// F. ExecutionNode
// Runs one Scheduler-approved assignment on the node where this Vroom process
// is already running. It owns process launch, interruption, cleanup, normalized
// results, and the small provider-neutral node receipt. It never chooses a node,
// creates a shard, assigns capacity, or transports results between machines.
async function ExecutionNode({
  applicationRoot,
  shard,
  node,
  allocatedCapacity,
  mode,
  executionContext,
  signal,
}) {
  let executionCommand = shard.job.command.replaceAll('{threads}', String(allocatedCapacity));
  if (shard.executionFiles.length) executionCommand += ` ${shard.executionFiles.join(' ')}`;
  const startedAt = new Date();
  const startedClock = Date.now();
  const result = await new Promise((complete) => {
    const child = spawn(executionCommand, {
      cwd: applicationRoot,
      env: {
        ...process.env,
        ...shard.job.environment,
        VROOM_EXECUTION_MODE: mode,
        VROOM_NODE_ID: node.id,
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
        termination = new Promise((finished) => {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch (error) {
            if (error.code !== 'ESRCH') terminationDetail = error.message;
          }
          forceTermination = setTimeout(() => {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch (error) {
              if (error.code !== 'ESRCH') terminationDetail = error.message;
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
        nodeId: node.id,
        nodeCapacity: node.capacity,
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
  if (!executionContext) return result;
  const receiptFolder = await mkdtemp(join(tmpdir(), 'vroom-receipts-'));
  const receiptPath = join(receiptFolder, `${shard.id}.json`);
  const receipt = {
    schema: 'vroom-node-receipt-v1',
    ...executionContext,
    shardId: result.shardId,
    jobName: result.jobName,
    nodeId: result.nodeId,
    nodeCapacity: result.nodeCapacity,
    allocatedThreads: result.allocatedCapacity,
    command: result.command,
    behavior: result.behavior,
    estimatedWeight: result.estimatedWeight,
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
    await rm(receiptFolder, { recursive: true, force: true });
    throw error;
  }
  return { ...result, receiptPath };
}

// G. ResultTransfer
// Moves node receipts, provider receipts, and timing records across an execution
// provider boundary. It owns provider discovery, direct GitHub job-result
// retrieval, artifact download and archive handling, and native-upload preparation, but it does
// not interpret timing, accept a receipt as valid planned work, retain history,
// or decide whether a run passed. GitHub currently uses native run artifacts.
// Mode 3 will add the approved controller/node transport here without changing
// Scheduler, ExecutionNode, or TimingResults ownership.
async function ResultTransfer(request) {
  const {
    action,
    applicationId,
    targetId,
    workload,
    mode,
    node,
    artifactReturn = null,
    receiptPaths = [],
    timingLogPaths = [],
    providerUnits = [],
  } = request;
  if (!['locate-history', 'download', 'upload'].includes(action))
    throw new Error(`ResultTransfer received unsupported action: ${action}`);
  if (mode !== 'github')
    throw new Error(`ResultTransfer ${action} is not implemented for ${mode} mode`);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(targetId))
    throw new Error('ResultTransfer requires a stable execution target id');
  const githubHeaders = (token) => ({
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Vroom',
  });

  if (action === 'locate-history') {
    if (process.env.GITHUB_ACTIONS !== 'true') return { artifactReturn: null };
    const repository = process.env.GITHUB_REPOSITORY?.trim();
    const token = process.env.VROOM_GITHUB_TOKEN?.trim();
    const currentRunId = process.env.GITHUB_RUN_ID?.trim();
    const branch = process.env.GITHUB_HEAD_REF?.trim() || process.env.GITHUB_REF_NAME?.trim();
    if (!repository || !token || !currentRunId || !branch) return { artifactReturn: null };
    const apiRoot = String(process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
    const headers = githubHeaders(token);
    const response = await fetch(`${apiRoot}/repos/${repository}/actions/artifacts?per_page=100`, { headers });
    if (!response.ok)
      throw new Error(`Unable to list GitHub timing history: HTTP ${response.status}`);
    const listing = await response.json();
    if (!Array.isArray(listing.artifacts))
      throw new Error('GitHub timing history listing did not contain an artifact list');
    const artifactPattern = new RegExp(`^vroom-${applicationId}-${targetId}-${workload}-(\\d+)-(\\d+)-reconciled$`);
    const previous = listing.artifacts
      .filter((artifact) => {
        const match = artifactPattern.exec(artifact.name ?? '');
        return match && !artifact.expired && match[1] !== currentRunId &&
          String(artifact.workflow_run?.id ?? '') === match[1] &&
          artifact.workflow_run?.head_branch === branch;
      })
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
    if (!previous) return { artifactReturn: null };
    const match = artifactPattern.exec(previous.name);
    process.stdout.write(`GitHub timing history: ${previous.name}\n`);
    return {
      artifactReturn: {
        repository,
        runId: match[1],
        runAttempt: match[2],
        token,
        apiUrl: apiRoot,
        artifactPrefix: previous.name,
        historyOnly: true,
      },
    };
  }

  if (action === 'download') {
    if (!artifactReturn) throw new Error('ResultTransfer download requires an artifact return');
    const repository = String(artifactReturn.repository ?? '').trim();
    const runId = String(artifactReturn.runId ?? '').trim();
    const runAttempt = String(artifactReturn.runAttempt ?? '').trim();
    const token = String(artifactReturn.token ?? '').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
      throw new Error('GitHub artifact return requires an owner/repository name');
    if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt))
      throw new Error('GitHub artifact return requires numeric run and attempt identities');
    if (!token) throw new Error('GitHub artifact return requires an API token');
    const apiRoot = String(artifactReturn.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
    const headers = githubHeaders(token);
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
    const artifactPrefix = artifactReturn.artifactPrefix ??
      `vroom-${applicationId}-${targetId}-${workload}-${runId}-${runAttempt}-`;
    const artifacts = listing.artifacts
      .filter((artifact) => !artifact.expired && typeof artifact.name === 'string' &&
        artifact.name.startsWith(artifactPrefix) &&
        typeof artifact.archive_download_url === 'string')
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!artifacts.length && !artifactReturn.allowEmpty)
      throw new Error(`No current GitHub result artifacts matched ${artifactPrefix}`);

    const receipts = new Map();
    const providerReceipts = new Map();
    const timingRecords = [];
    for (const artifact of artifacts) {
      const archiveResponse = await fetch(artifact.archive_download_url, { headers });
      if (!archiveResponse.ok)
        throw new Error(`Unable to download GitHub artifact ${artifact.name}: HTTP ${archiveResponse.status}`);
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      const temporaryRoot = await mkdtemp(join(tmpdir(), 'vroom-artifact-'));
      try {
        const archivePath = join(temporaryRoot, 'artifact.zip');
        const extractedRoot = join(temporaryRoot, 'extracted');
        await writeFile(archivePath, archive);
        await mkdir(extractedRoot);
        const extraction = spawnSync('/usr/bin/unzip', ['-qq', archivePath, '-d', extractedRoot]);
        if (extraction.status !== 0)
          throw new Error(`Unable to extract GitHub artifact ${artifact.name}`);
        for (const name of await readdir(extractedRoot, { recursive: true })) {
          const filePath = join(extractedRoot, name);
          const fileStats = await stat(filePath);
          if (!fileStats.isFile()) continue;
          const data = await readFile(filePath, 'utf8');
          let record;
          try {
            record = JSON.parse(data);
          } catch { continue; }
          if (record.schema === 'vroom-node-receipt-v1') {
            if (String(record.runId) !== runId || String(record.runAttempt) !== runAttempt || record.repository !== repository || record.executionTarget !== targetId || receipts.has(record.shardId))
              throw new Error(`GitHub artifact ${artifact.name} returned an invalid node receipt`);
            receipts.set(record.shardId, record);
          } else if (record.schema === 'vroom-timing-v1') {
            if (record.executionMode !== 'github' || record.executionTarget !== targetId || !Array.isArray(record.results)) throw new Error(`GitHub artifact ${artifact.name} returned invalid timing data`);
            timingRecords.push(record);
          }
        }
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }
    if (!receipts.size && !artifactReturn.allowEmpty && !artifactReturn.historyOnly)
      throw new Error('GitHub artifact return contained no Vroom receipts');
    if (artifactReturn.historyOnly && !timingRecords.length)
      throw new Error('GitHub timing-history artifact contained no Vroom timing record');
    if (providerUnits.length) {
      const resultNames = new Set();
      for (const unit of providerUnits) {
        if (unit.provider !== 'github-actions' || typeof unit.id !== 'string' ||
            typeof unit.jobName !== 'string' || typeof unit.workflow !== 'string' ||
            typeof unit.workflowJob !== 'string' || typeof unit.resultName !== 'string' ||
            !unit.resultName || resultNames.has(unit.resultName))
          throw new Error('GitHub plan contains invalid or duplicate provider result identities');
        resultNames.add(unit.resultName);
      }
      const jobsResponse = await fetch(
        `${apiRoot}/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
        { headers }
      );
      if (!jobsResponse.ok)
        throw new Error(`Unable to list GitHub provider results: HTTP ${jobsResponse.status}`);
      const jobsListing = await jobsResponse.json();
      if (!Array.isArray(jobsListing.jobs))
        throw new Error('GitHub provider result listing did not contain a job list');
      if (Number(jobsListing.total_count) > jobsListing.jobs.length)
        throw new Error('GitHub provider result return exceeded one result page');
      for (const unit of providerUnits) {
        const matches = jobsListing.jobs.filter((job) =>
          job.name === unit.resultName && String(job.run_attempt ?? runAttempt) === runAttempt);
        if (matches.length !== 1)
          throw new Error(`GitHub provider result ${unit.resultName} expected one job; found ${matches.length}`);
        const job = matches[0];
        if (typeof job.conclusion !== 'string' || !job.completed_at)
          throw new Error(`GitHub provider result is not complete: ${unit.resultName}`);
        const startedAt = job.started_at ?? job.completed_at;
        const durationMs = Math.max(0, Date.parse(job.completed_at) - Date.parse(startedAt));
        providerReceipts.set(unit.id, {
          provider: unit.provider,
          executionTarget: targetId,
          repository,
          runId,
          runAttempt,
          commitSha: artifactReturn.commitSha ?? null,
          providerUnitId: unit.id,
          jobName: unit.jobName,
          workflow: unit.workflow,
          workflowJob: unit.workflowJob,
          providerJobName: job.name,
          conclusion: job.conclusion,
          startedAt,
          finishedAt: job.completed_at,
          durationMs: Number.isFinite(durationMs) ? durationMs : 0,
        });
      }
    }
    return { receipts, providerReceipts, timingRecords };
  }

  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('GitHub result upload requires the GitHub Actions environment');
  const runId = process.env.GITHUB_RUN_ID?.trim();
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT?.trim();
  const outputPath = process.env.GITHUB_OUTPUT?.trim();
  if (!runId || !runAttempt || !outputPath)
    throw new Error('GitHub artifact upload requires run, attempt, and step-output values');
  const reconcileUpload = process.env.VROOM_GITHUB_RECONCILE === 'true';
  if (!reconcileUpload && !node?.id)
    throw new Error('GitHub worker artifact upload requires a node identity');
  const artifactName = `vroom-${applicationId}-${targetId}-${workload}-${runId}-${runAttempt}-${reconcileUpload ? 'reconciled' : node.id}`;
  const uploadFiles = [...new Set([...receiptPaths, ...timingLogPaths])];
  if (!uploadFiles.length)
    throw new Error(`GitHub artifact ${artifactName} has no Vroom records to upload`);
  const artifactPaths = uploadFiles.map((filePath) => resolve(filePath).replace(/\\/g, '/'));
  const delimiter = `VROOM_ARTIFACT_PATHS_${process.pid}`;
  await appendFile(outputPath,
    `artifact-name=${artifactName}\nartifact-paths<<${delimiter}\n${artifactPaths.join('\n')}\n${delimiter}\n`, 'utf8');
  process.stdout.write(`GitHub artifact prepared: ${artifactName}\n`);
}

// H. TimingResults
// Owns timing-history intake and completed-result storage for the application
// that invoked Vroom. It reads comparable timing logs for Scheduler, validates
// returned node and provider receipts while they are temporary, writes the
// combined timing record, and keeps only the latest five timing logs. For hosted work it
// downloads the expected GitHub artifacts itself, requires the provider-native
// GitHub job results, compares all receipts with Scheduler's immutable plan, and
// interprets their timing records. It does not
// schedule work or assign shards.
async function TimingResults(request) {
  const {
    action,
    applicationRoot,
    applicationId,
    developerDataRoot,
    targetId,
    workload,
    profiles = [],
    selectedJobNames = [],
    mode,
    node,
    resources,
    results: suppliedResults = [],
    history = new Map(),
    githubReturn = null,
    expectedPlan = null,
  } = request;
  if (!['read', 'save'].includes(action))
    throw new Error(`TimingResults received unsupported action: ${action}`);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(targetId))
    throw new Error('TimingResults requires a stable execution target id');

  const workloadLogRoot = join(developerDataRoot, `timing-${targetId}`, workload);
  const timingLogFolders = profiles.length
    ? profiles.map((profile) => ({ profile, path: join(workloadLogRoot, profile.name) }))
    : selectedJobNames.length || suppliedResults.length || githubReturn
      ? [{ profile: null, path: workloadLogRoot }]
      : [];
  const timingPrefix = 'timing-';
  for (const source of timingLogFolders) {
    await mkdir(source.path, { recursive: true });
    const existing = (await readdir(source.path))
      .filter((entry) => entry.startsWith(timingPrefix) && entry.endsWith('.log'))
      .sort();
    for (const expired of existing.slice(0, -TIMING_LOG_LIMIT))
      await unlink(join(source.path, expired));
    source.files = existing.slice(-TIMING_LOG_LIMIT);
  }

  let completedResults = suppliedResults;
  let downloadedReceipts = new Map();
  let downloadedProviderReceipts = new Map();
  let downloadedTimingRecords = [];
  const historyRecords = [];
  let artifactReturn = githubReturn;
  if (
    !artifactReturn &&
    action === 'read' &&
    mode === 'github' &&
    process.env.GITHUB_ACTIONS === 'true'
  ) {
    ({ artifactReturn } = await ResultTransfer({
      action: 'locate-history',
      applicationId,
      targetId,
      workload,
      mode,
    }));
  }

  if (action === 'read') {
    for (const source of timingLogFolders) {
      for (const name of source.files) {
        try {
          const record = JSON.parse(await readFile(join(source.path, name), 'utf8'));
          if (
            record.schema !== 'vroom-timing-v1' ||
            record.applicationId !== applicationId ||
            (record.executionTarget && record.executionTarget !== targetId) ||
            record.workload !== workload ||
            !Array.isArray(record.results) ||
            (source.profile && !record.profiles?.includes(source.profile.name))
          )
            continue;
          historyRecords.push({ profile: source.profile, record });
        } catch {
          process.stderr.write(
            `Vroom warning: ignored unreadable timing log ${join(source.path, name)}\n`
          );
        }
      }
    }
  }

  if (artifactReturn) {
    if (mode !== 'github') throw new Error('GitHub artifact return requires GitHub mode');
    ({
      receipts: downloadedReceipts,
      providerReceipts: downloadedProviderReceipts,
      timingRecords: downloadedTimingRecords,
    } = await ResultTransfer({
      action: 'download', applicationId, targetId, workload, mode, artifactReturn,
      providerUnits: expectedPlan?.providerUnits ?? [],
    }));
    if (expectedPlan) {
      if (expectedPlan.targetId !== targetId)
        throw new Error('GitHub return target does not match the immutable plan');
      const expectedAssignments = new Map(expectedPlan.assignments.map((item) => [item.shardId, item]));
      const expectedProviderUnits = new Map(expectedPlan.providerUnits.map((item) => [item.id, item]));
      if (expectedAssignments.size !== expectedPlan.assignments.length || expectedProviderUnits.size !== expectedPlan.providerUnits.length ||
          downloadedReceipts.size !== expectedAssignments.size || downloadedProviderReceipts.size !== expectedProviderUnits.size)
        throw new Error('GitHub return does not contain exactly the planned work');
      for (const [shardId, assignment] of expectedAssignments) {
        const receipt = downloadedReceipts.get(shardId);
        if (!receipt || receipt.provider !== expectedPlan.provider || receipt.repository !== expectedPlan.repository ||
            String(receipt.runId) !== String(expectedPlan.runId) || String(receipt.runAttempt) !== String(expectedPlan.runAttempt) ||
            receipt.commitSha !== expectedPlan.commitSha || receipt.jobName !== assignment.jobName ||
            receipt.nodeId !== assignment.nodeId || receipt.nodeCapacity !== assignment.nodeCapacity ||
            !Number.isInteger(receipt.allocatedThreads) || receipt.allocatedThreads < 1 ||
            receipt.allocatedThreads > assignment.nodeCapacity ||
            receipt.estimatedWeight !== assignment.estimatedWeight ||
            !['passed', 'failed', 'interrupted'].includes(receipt.result) ||
            typeof receipt.command !== 'string' || !receipt.command ||
            !Number.isFinite(receipt.durationMs) || receipt.durationMs < 0 ||
            !Number.isFinite(Date.parse(receipt.startedAt)) ||
            !Number.isFinite(Date.parse(receipt.finishedAt)) ||
            Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt))
          throw new Error(`GitHub receipt does not match planned assignment ${shardId}`);
      }
      for (const [unitId, unit] of expectedProviderUnits) {
        const receipt = downloadedProviderReceipts.get(unitId);
        if (!receipt || receipt.provider !== unit.provider || receipt.repository !== expectedPlan.repository ||
            receipt.executionTarget !== targetId ||
            String(receipt.runId) !== String(expectedPlan.runId) || String(receipt.runAttempt) !== String(expectedPlan.runAttempt) ||
            receipt.commitSha !== expectedPlan.commitSha || receipt.jobName !== unit.jobName ||
            receipt.workflow !== unit.workflow || receipt.workflowJob !== unit.workflowJob || receipt.providerJobName !== unit.resultName)
          throw new Error(`GitHub provider receipt does not match planned unit ${unitId}`);
      }
    }
    if (action === 'save' && !expectedPlan) {
      const matchingRecords = downloadedTimingRecords.filter(
        (record) =>
          record.applicationId === applicationId &&
          record.executionTarget === targetId &&
          record.workload === workload &&
          Array.isArray(record.results) &&
          record.results.length
      );
      const uniqueRecords = new Map(
        matchingRecords.map((record) => [JSON.stringify(record), record])
      );
      if (uniqueRecords.size !== 1)
        throw new Error(
          `Completed GitHub return expected one reconciled timing record; found ${uniqueRecords.size}`
        );
      completedResults = [...uniqueRecords.values()][0].results;
    } else {
      const returnedResults = [
        ...[...downloadedReceipts.values()].map((receipt) => ({
          shardId: receipt.shardId,
          jobName: receipt.jobName,
          command: receipt.command,
          behavior: receipt.behavior,
          estimatedWeight: receipt.estimatedWeight,
          nodeId: receipt.nodeId,
          nodeCapacity: receipt.nodeCapacity,
          allocatedCapacity: receipt.allocatedThreads,
          startedAt: receipt.startedAt,
          finishedAt: receipt.finishedAt,
          durationMs: receipt.durationMs,
          status: receipt.result,
          exitCode: receipt.exitCode,
          detail: receipt.detail,
        })),
        ...[...downloadedProviderReceipts.values()].map((receipt) => ({
            shardId: receipt.providerUnitId,
            providerUnitId: receipt.providerUnitId,
            jobName: receipt.jobName,
            command: `workflow ${receipt.workflow} ${receipt.workflowJob}`,
            behavior: 'provider-native',
            estimatedWeight: null,
            nodeId: receipt.provider,
            nodeCapacity: 0,
            allocatedCapacity: 0,
            startedAt: receipt.startedAt,
            finishedAt: receipt.finishedAt,
            durationMs: receipt.durationMs,
            status: receipt.conclusion === 'success' ? 'passed' : 'failed',
            exitCode: receipt.conclusion === 'success' ? 0 : 1,
            detail:
              receipt.conclusion === 'success'
                ? receipt.providerJobName
                : `${receipt.providerJobName}: ${receipt.conclusion}`,
          })),
      ];
      completedResults = returnedResults.sort(
        (left, right) =>
          left.jobName.localeCompare(right.jobName) || left.shardId.localeCompare(right.shardId)
      );
    }
  }

  if (action === 'read') {
    for (const record of downloadedTimingRecords) {
      if (
        record.applicationId !== applicationId ||
        record.workload !== workload ||
        !Array.isArray(record.results)
      )
        continue;
      if (profiles.length) {
        for (const profile of profiles)
          if (record.profiles?.includes(profile.name)) historyRecords.push({ profile, record });
      } else historyRecords.push({ profile: null, record });
    }
    const loadedHistory = new Map();
    const performanceSamples = new Map();
    for (const source of historyRecords) {
      const workerGroup = [...new Set(source.record.results
        .filter((result) =>
          result.status === 'passed' &&
          result.behavior === 'worker-based' &&
          Number.isInteger(result.allocatedCapacity) &&
          result.allocatedCapacity > 0
        )
        .map((result) => result.jobName))]
        .sort()
        .join('\u0000');
      for (const result of source.record.results) {
        if (source.profile && !source.profile.jobs.includes(result.jobName)) continue;
        if (
          result.status === 'passed' &&
          typeof result.nodeId === 'string' &&
          Number.isFinite(result.estimatedWeight) &&
          result.estimatedWeight > 0 &&
          Number.isFinite(result.durationMs) &&
          result.durationMs > 0 &&
          Number.isInteger(result.allocatedCapacity) &&
          result.allocatedCapacity > 0
        ) {
          if (!performanceSamples.has(result.nodeId)) performanceSamples.set(result.nodeId, []);
          performanceSamples
            .get(result.nodeId)
            .push(result.estimatedWeight / (result.durationMs * result.allocatedCapacity));
        }
        if (result.status !== 'passed' || typeof result.jobName !== 'string' ||
            typeof result.command !== 'string' || !Number.isFinite(result.durationMs))
          continue;
        const key = `${result.jobName}\u0000${result.command}`;
        if (!loadedHistory.has(key)) loadedHistory.set(key, []);
        loadedHistory.get(key).push({
          durationMs: result.durationMs,
          allocatedCapacity: Number.isInteger(result.allocatedCapacity) && result.allocatedCapacity > 0
            ? result.allocatedCapacity : 1,
          nodeId: result.nodeId, nodeCapacity: result.nodeCapacity, workerGroup,
        });
      }
    }
    return { history: loadedHistory, performanceSamples };
  }

  const receiptPaths = [];
  if (mode === 'github') {
    for (const result of completedResults.filter((entry) => entry.receiptPath)) {
      const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'));
      if (
        receipt.schema !== 'vroom-node-receipt-v1' ||
        receipt.shardId !== result.shardId ||
        receipt.jobName !== result.jobName ||
        receipt.nodeId !== result.nodeId ||
        receipt.allocatedThreads !== result.allocatedCapacity ||
        receipt.result !== result.status ||
        receipt.exitCode !== result.exitCode
      )
        throw new Error(`Node receipt does not match execution result for ${result.shardId}`);
      receiptPaths.push(result.receiptPath);
    }
    const accepted = receiptPaths.length + downloadedReceipts.size + downloadedProviderReceipts.size;
    if (accepted) process.stdout.write(`Temporary receipts accepted: ${accepted}\n`);
  }

  if (!completedResults.length)
    return { results: completedResults, timingLogPaths: [] };
  const timingLogPaths = [];
  const githubWorker =
    mode === 'github' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.VROOM_GITHUB_RECONCILE !== 'true';
  if (!githubWorker) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const timingRecord = {
      schema: 'vroom-timing-v1',
      applicationId,
      executionMode: mode,
      executionTarget: targetId,
      workload,
      profiles: profiles.map((profile) => profile.name),
      applicationRoot,
      controllerId: resources.controllerId,
      startedWithHistory: history.size > 0,
      nodes: resources.nodes,
      results: completedResults.map((result) => {
        const storedResult = { ...result };
        delete storedResult.receiptPath;
        const previous = history.get(`${result.jobName}\u0000${result.command}`) ?? [];
        if (result.behavior === 'provider-native')
          return {
            ...storedResult,
            timingSamples: 0,
            averageDurationMs: null,
            averageWorkerMs: null,
          };
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
        const averageDurationMs = samples.length
          ? Math.round(samples.reduce((total, sample) => total + sample.durationMs, 0) / samples.length)
          : null;
        const averageWorkerMs = samples.length
          ? Math.round(samples.reduce((total, sample) =>
              total + sample.durationMs * sample.allocatedCapacity, 0) / samples.length)
          : null;
        return { ...storedResult, timingSamples: samples.length, averageDurationMs, averageWorkerMs };
      }),
    };
    for (const source of timingLogFolders) {
      const timingFile = `${timingPrefix}${timestamp}.log`;
      const timingLogPath = join(source.path, timingFile);
      await writeFile(timingLogPath, `${JSON.stringify(timingRecord, null, 2)}\n`, 'utf8');
      timingLogPaths.push(timingLogPath);
      if (source.files.length === TIMING_LOG_LIMIT) await unlink(join(source.path, source.files[0]));
    }
  }
  if (
    mode === 'github' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    (receiptPaths.length || timingLogPaths.length)
  ) {
    await ResultTransfer({
      action: 'upload',
      applicationId,
      targetId,
      workload,
      mode,
      node,
      receiptPaths,
      timingLogPaths,
    });
  }
  return {
    results: completedResults,
    timingLogPaths,
  };
}

// I. Scheduler
// Owns the one application-agnostic scheduler used by every Vroom mode. It
// creates and displays the application-work plan, loads Vroom configuration,
// obtains CPU and weighted node resources, resolves generic command behavior,
// creates and assigns deterministic local or multi-node shards, records native
// provider units, emits one immutable GitHub run-attempt plan and node matrix,
// applies changed-file rules,
// enforces dependencies and exclusivity,
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
  { githubPlan = false, vroomConfiguration } = {}
) {
  if (!vroomConfiguration) throw new Error('Scheduler requires normalized Vroom configuration');
  const kindOrder = { check: 0, prepare: 1, build: 2, 'post-build': 3 };
  const plan = {
    ...configuration,
    jobs: [...configuration.jobs].sort(
      (left, right) => kindOrder[left.kind] - kindOrder[right.kind] || left.name.localeCompare(right.name)
    ),
  };
  const targetId = vroomConfiguration[mode]?.targetId;
  if (!targetId) throw new Error(`No execution target is configured for ${mode} mode`);
  if (mode !== 'github' && plan.jobs.some((job) => job.provider))
    throw new Error('Provider-native workflow jobs require GitHub execution mode');
  process.stdout.write(
    `Vroom plan\nApplication: ${plan.applicationRoot}\nConfiguration: ${plan.configPath}\n` +
      `Workload: ${plan.workload}\nJobs:\n`
  );
  for (const job of plan.jobs) {
    const facts = [job.kind];
    if (job.after.length) facts.push(`after ${job.after.join(', ')}`);
    if (job.exclusive) facts.push('exclusive');
    if (job.when.length) facts.push(`when ${job.when.join(', ')}`);
    if (job.compare) facts.push(`compare ${job.compare}`);
    if (job.files.length) facts.push(`files ${job.files.join(', ')}`);
    if (job.provider)
      facts.push(
        `${job.provider.name} ${job.provider.workflow} ${job.provider.job}; ${job.provider.results.length} result(s)`
      );
    process.stdout.write(`  - ${job.name} (${facts.join('; ')}): ${job.command}\n`);
  }
  process.stdout.write('\n');
  const githubContext =
    mode === 'github' && !githubPlan
      ? await Controller({
          mode,
          request: {
            action: 'context',
            applicationId: plan.applicationId,
            targetId,
            workload: plan.workload,
          },
        })
      : null;
  const githubExecutionPlan = githubContext?.plan ?? null;
  const plannedJobNames = githubExecutionPlan
    ? new Set([...githubExecutionPlan.assignments, ...githubExecutionPlan.providerUnits]
        .map((entry) => entry.jobName))
    : null;
  const changedFilesByReference = new Map();
  const selectedFilesByJob = new Map();
  for (const job of plan.jobs) {
    if (githubExecutionPlan) {
      selectedFilesByJob.set(job.name,
        plannedJobNames.has(job.name) && job.when.length ? ['planned'] : []);
      continue;
    }
    if (!job.when.length) {
      selectedFilesByJob.set(job.name, []);
      continue;
    }
    if (!changedFilesByReference.has(job.compare)) {
      const mergeBaseResult = spawnSync('git', ['-C', plan.applicationRoot, 'merge-base', 'HEAD', job.compare], {
        encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024,
      });
      if (mergeBaseResult.status !== 0)
        throw new Error(`Unable to compare with ${job.compare}: ${(mergeBaseResult.stderr ?? '').toString().trim() || 'git merge-base failed'}`);
      const mergeBase = (mergeBaseResult.stdout ?? '').toString().trim();
      const changedFiles = new Set();
      for (const query of [
        ['diff', '--name-only', '-z', '--diff-filter=ACMR', `${mergeBase}..HEAD`],
        ['diff', '--name-only', '-z', '--diff-filter=ACMR'],
        ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'],
        ['ls-files', '--others', '--exclude-standard', '-z'],
      ]) {
        const result = spawnSync('git', ['-C', plan.applicationRoot, ...query], {
          encoding: 'buffer', windowsHide: true, maxBuffer: 10 * 1024 * 1024,
        });
        if (result.status !== 0)
          throw new Error(`Unable to read changed files for ${job.compare}: ${(result.stderr ?? Buffer.alloc(0)).toString('utf8').trim() || 'git query failed'}`);
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
    if (selectedFiles.some((file) => !/^[a-z0-9_./@+-]+$/i.test(file)))
      throw new Error('A changed path requires unsupported shell quoting');
    selectedFilesByJob.set(job.name, selectedFiles);
  }
  const selectedJobNames = plannedJobNames
    ? [...plannedJobNames].sort()
    : plan.jobs.filter((job) => !job.when.length || selectedFilesByJob.get(job.name)?.length).map((job) => job.name).sort();
  const selectedJobSet = new Set(selectedJobNames);
  const activeProfiles = plan.profiles.filter((profile) => profile.jobs.some((name) => selectedJobSet.has(name)));
  if (activeProfiles.some((profile) => !profile.jobs.every((name) => selectedJobSet.has(name))))
    throw new Error(`${plan.configPath}: a selected ${plan.workload} profile is incomplete`);
  if (plan.profiles.length) {
    const profiledJobNames = new Set(activeProfiles.flatMap((profile) => profile.jobs));
    const unprofiledJobNames = selectedJobNames.filter((jobName) => !profiledJobNames.has(jobName));
    if (unprofiledJobNames.length) throw new Error(`${plan.configPath}: unprofiled selected jobs: ${unprofiledJobNames.join(', ')}`);
  }

  const timingRequest = {
    applicationRoot: plan.applicationRoot,
    applicationId: plan.applicationId,
    developerDataRoot: plan.developerDataRoot,
    targetId,
    workload: plan.workload,
    profiles: activeProfiles,
    selectedJobNames,
  };
  const preliminaryTimingState = await TimingResults({ ...timingRequest, action: 'read', mode, node: null });
  const resources = await CpuThreadPlanning(mode, vroomConfiguration,
    preliminaryTimingState.performanceSamples);
  if (githubContext?.phase === 'reconcile') {
    const timingOutcome = await TimingResults({
      ...timingRequest,
      action: 'save',
      mode,
      node: null,
      resources,
      results: [],
      history: preliminaryTimingState.history,
      expectedPlan: githubExecutionPlan,
      githubReturn: githubContext.artifactReturn,
    });
    if ((githubExecutionPlan || githubContext.executionResult) &&
        githubContext.executionResult !== 'success')
      throw new Error(`GitHub node execution completed with ${githubContext.executionResult ?? 'an unknown result'}`);
    return { resources, ...timingOutcome };
  }

  const multiNode = resources.nodes.length > 1;
  const nodeAssignments = new Map();
  if (multiNode) {
    const unsupported = plan.jobs.filter((job) =>
      selectedJobSet.has(job.name) && !job.provider && (job.after.length || job.exclusive));
    if (unsupported.length)
      throw new Error(`Multi-node dependencies or exclusivity are not implemented: ${unsupported
        .map((job) => job.name).join(', ')}`);
  }
  if (githubExecutionPlan) {
    const nodes = new Map(resources.nodes.map((node) => [node.id, node]));
    const plannedNodes = new Map(githubExecutionPlan.nodes.map((node) => [node.id, node]));
    if (plannedNodes.size !== nodes.size || [...nodes].some(([id, node]) => plannedNodes.get(id)?.capacity !== node.capacity))
      throw new Error('GitHub plan node capacity does not match vroom.cfg');
    const jobsByName = new Map(plan.jobs.map((job, index) => [job.name, { job, index }]));
    const shardIds = new Set();
    const assignedFilesByJob = new Map();
    for (const assignment of githubExecutionPlan.assignments) {
      const entry = jobsByName.get(assignment.jobName);
      const targetNode = nodes.get(assignment.nodeId);
      const expectedId = entry && `${`shard-${String(entry.index + 1).padStart(2, '0')}`}${multiNode ? `-${assignment.nodeId}` : ''}`;
      const assignedFiles = Array.isArray(assignment.executionFiles) ? assignment.executionFiles : [];
      const uniqueFiles = new Set(assignedFiles);
      const fileJob = Boolean(entry?.job.files.length);
      const validShape = fileJob
        ? assignment.wholeJob === false &&
          assignedFiles.length > 0 &&
          uniqueFiles.size === assignedFiles.length &&
          assignedFiles.every((file) => entry.job.files.includes(file))
        : assignment.wholeJob === true && assignedFiles.length === 0;
      if (!entry || entry.job.provider || !targetNode || assignment.shardId !== expectedId || shardIds.has(expectedId) ||
          assignment.nodeCapacity !== targetNode.capacity || !validShape ||
          !Number.isFinite(assignment.estimatedWeight) || assignment.estimatedWeight <= 0 ||
          assignedFiles.some((file) => typeof file !== 'string' || !/^[a-z0-9_./@+-]+$/i.test(file)))
        throw new Error(`GitHub plan contains an invalid assignment for ${assignment.jobName}`);
      shardIds.add(expectedId);
      if (!assignedFilesByJob.has(entry.job.name)) assignedFilesByJob.set(entry.job.name, new Set());
      const recordedFiles = assignedFilesByJob.get(entry.job.name);
      if (assignedFiles.some((file) => recordedFiles.has(file)))
        throw new Error(`GitHub plan assigns a file more than once for ${entry.job.name}`);
      for (const file of assignedFiles) recordedFiles.add(file);
      if (!nodeAssignments.has(entry.job.name)) nodeAssignments.set(entry.job.name, []);
      nodeAssignments.get(entry.job.name).push({
        nodeId: assignment.nodeId,
        files: [...assignedFiles],
        wholeJob: Boolean(assignment.wholeJob),
        estimatedWeight: assignment.estimatedWeight,
        shardId: assignment.shardId,
      });
    }
    for (const job of plan.jobs) {
      if (!selectedJobSet.has(job.name) || job.provider) continue;
      const assignments = nodeAssignments.get(job.name) ?? [];
      const recordedFiles = assignedFilesByJob.get(job.name) ?? new Set();
      if ((job.files.length && (recordedFiles.size !== job.files.length ||
            job.files.some((file) => !recordedFiles.has(file)))) ||
          (!job.files.length && assignments.length !== 1))
        throw new Error(`GitHub plan does not contain exactly the configured work for ${job.name}`);
    }
    const unitIds = new Set();
    const unitKeys = new Set();
    for (const unit of githubExecutionPlan.providerUnits) {
      const entry = jobsByName.get(unit.jobName);
      const provider = entry?.job.provider;
      const resultIndex = provider?.results.indexOf(unit.resultName) ?? -1;
      const expectedId = entry && resultIndex >= 0
        ? `provider-${String(entry.index + 1).padStart(2, '0')}-${String(resultIndex + 1).padStart(2, '0')}`
        : null;
      const unitKey = `${unit.jobName}\u0000${unit.resultName}`;
      if (!provider || unitIds.has(unit.id) || unitKeys.has(unitKey) || unit.id !== expectedId ||
          unit.provider !== provider.name || unit.workflow !== provider.workflow ||
          unit.workflowJob !== provider.job || resultIndex < 0)
        throw new Error(`GitHub plan contains an invalid provider unit: ${unit.id}`);
      unitIds.add(unit.id);
      unitKeys.add(unitKey);
    }
    for (const job of plan.jobs) {
      if (!selectedJobSet.has(job.name) || !job.provider) continue;
      if (job.provider.results.some((resultName) => !unitKeys.has(`${job.name}\u0000${resultName}`)))
        throw new Error(`GitHub plan does not contain every provider result for ${job.name}`);
    }
  } else if (multiNode) {
    for (const [jobIndex, job] of plan.jobs.entries()) {
      if (!selectedJobSet.has(job.name) || job.provider) continue;
      const assignments = resources.nodes.map((node) => ({
        nodeId: node.id,
        weightedCapacity: node.weightedCapacity,
        estimatedWeight: 0,
        files: [],
        wholeJob: false,
      }));
      if (job.files.length) {
        const samplesByFile = new Map();
        for (const [key, samples] of preliminaryTimingState.history) {
          const parts = key.split('\u0000');
          const timedFiles = parts[0] === job.name && parts[1] === job.command
            ? parts.slice(2).filter((file) => job.files.includes(file))
            : [];
          for (const file of timedFiles) {
            if (!samplesByFile.has(file)) samplesByFile.set(file, []);
            samplesByFile.get(file).push(...samples.slice(-5).map((sample) => sample.durationMs / timedFiles.length));
          }
        }
        const work = await Promise.all(job.files.map(async (file) => {
          const samples = samplesByFile.get(file) ?? [];
          const fileStats = await stat(join(plan.applicationRoot, file));
          return {
            file,
            weight: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length
              : Math.max(1, fileStats.isFile() ? fileStats.size : 1),
          };
        }));
        work.sort((left, right) => right.weight - left.weight || left.file.localeCompare(right.file));
        for (const item of work) {
          const target = assignments.reduce((best, candidate) =>
            candidate.estimatedWeight / candidate.weightedCapacity < best.estimatedWeight / best.weightedCapacity ? candidate : best
          );
          target.files.push(item.file);
          target.estimatedWeight += item.weight;
        }
        for (const assignment of assignments) assignment.files.sort();
      } else {
        assignments[jobIndex % assignments.length].wholeJob = true;
        assignments[jobIndex % assignments.length].estimatedWeight = 1;
      }
      nodeAssignments.set(job.name, assignments);
    }
  }

  if (githubPlan) {
    if (mode !== 'github') throw new Error('--github-plan requires GitHub execution mode');
    const assignments = [];
    for (let jobIndex = 0; jobIndex < plan.jobs.length; jobIndex += 1) {
      const job = plan.jobs[jobIndex];
      if (!selectedJobSet.has(job.name) || job.provider) continue;
      if (multiNode) {
        for (const assignment of nodeAssignments.get(job.name) ?? []) {
          const assigned = job.files.length ? assignment.files.length > 0 : assignment.wholeJob;
          if (!assigned) continue;
          assignments.push({
            jobName: job.name,
            shardId: `shard-${String(jobIndex + 1).padStart(2, '0')}-${assignment.nodeId}`,
            nodeId: assignment.nodeId,
            nodeCapacity: resources.nodes.find((node) => node.id === assignment.nodeId).capacity,
            executionFiles: [...assignment.files],
            wholeJob: assignment.wholeJob,
            estimatedWeight: assignment.estimatedWeight,
          });
        }
      } else {
        assignments.push({
          jobName: job.name,
          shardId: `shard-${String(jobIndex + 1).padStart(2, '0')}`,
          nodeId: resources.nodes[0].id,
          nodeCapacity: resources.nodes[0].capacity,
          executionFiles: [...job.files],
          wholeJob: !job.files.length,
          estimatedWeight: null,
        });
      }
    }
    const providerUnits = plan.jobs.flatMap((job, jobIndex) =>
      !selectedJobSet.has(job.name) || !job.provider
        ? []
        : job.provider.results.map((resultName, resultIndex) => ({
          id: `provider-${String(jobIndex + 1).padStart(2, '0')}-${String(resultIndex + 1).padStart(2, '0')}`,
          jobName: job.name,
          provider: job.provider.name,
          workflow: job.provider.workflow,
          workflowJob: job.provider.job,
          resultName,
        }))
    );
    const { matrix } = await Controller({
      mode,
      request: {
        action: 'publish-plan',
        applicationId: plan.applicationId,
        targetId,
        workload: plan.workload,
        nodes: resources.nodes.map(({ id, capacity }) => ({ id, capacity })),
        assignments,
        providerUnits,
      },
    });
    process.stdout.write(
      `GitHub node matrix: ${matrix.node.join(', ')}\n` +
        `Configured capacity: ${resources.totalCapacity} thread slots across ${resources.nodes.length} node(s)\n` +
        `Immutable assignments: ${assignments.length}\n` +
        `Provider-native results: ${providerUnits.length}\n`
    );
    return { resources, results: [], timingLogPaths: [], plannedOnly: true };
  }

  const requestedNodeId = githubContext?.nodeId ?? null;
  let node = resources.nodes[0];
  if (mode === 'github' && requestedNodeId)
    node = resources.nodes.find((candidate) => candidate.id === requestedNodeId);
  else if (multiNode)
    throw new Error('Multi-node execution requires a controller-selected node');
  if (!node || node.capacity < 1)
    throw new Error(
      requestedNodeId
        ? `Configured node does not exist or has no capacity: ${requestedNodeId}`
        : `${mode} execution node has no capacity`
    );
  const history = preliminaryTimingState.history;
  const distributed = Boolean(githubExecutionPlan || multiNode);
  const shards = plan.jobs.filter((job) => !job.provider).map((job) => {
    const index = plan.jobs.indexOf(job);
    const selectedFiles = selectedFilesByJob.get(job.name) ?? [];
    const nodeAssignment = distributed
      ? nodeAssignments.get(job.name)?.find((assignment) => assignment.nodeId === node.id)
      : null;
    const assignedToNode = distributed
      ? Boolean(nodeAssignment && (nodeAssignment.shardId || nodeAssignment.wholeJob || nodeAssignment.files.length))
      : true;
    const executionFiles = distributed ? nodeAssignment?.files ?? [] : job.files;
    let historyCommand = executionFiles.length
      ? `${job.command}\u0000${executionFiles.join('\u0000')}`
      : job.command;
    const environmentEntries = Object.entries(job.environment)
      .sort(([left], [right]) => left.localeCompare(right));
    if (environmentEntries.length)
      historyCommand += `\u0000env\u0000${environmentEntries
        .map(([name, value]) => `${name}=${value}`)
        .join('\u0000')}`;
    return {
      id: nodeAssignment?.shardId ?? (multiNode
        ? `shard-${String(index + 1).padStart(2, '0')}-${node.id}`
        : `shard-${String(index + 1).padStart(2, '0')}`),
      job,
      behavior: job.behavior,
      selectedFiles,
      executionFiles,
      assignedToNode,
      estimatedWeight: nodeAssignment?.estimatedWeight ?? null,
      historyCommand,
      timingSamples: history.get(`${job.name}\u0000${historyCommand}`) ?? [],
      averageDurationMs: null,
      averageWorkerMs: null,
      originalOrder: index,
      assignment: nodeAssignment?.shardId
        ? {
            shardId: nodeAssignment.shardId,
            jobName: job.name,
            nodeId: nodeAssignment.nodeId,
            nodeCapacity: node.capacity,
          }
        : null,
    };
  });

  const activeWorkerGroup = shards
    .filter(
      (shard) =>
        shard.assignedToNode &&
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
          sample.nodeCapacity === node.capacity &&
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

  }

  process.stdout.write(
    `Execution: ${mode}\n` +
      `Resource configuration: ${resources.configPath}\n` +
      `Controller/node: ${node.name} (${node.availableLogicalCpus} configured logical CPUs, ${node.threadPolicy} = ${node.capacity} thread slots)\n` +
      `Timing history: ${history.size ? `${history.size} matching job record(s)` : 'none; this run is the calibration run'}\n\n`
  );
  if (multiNode) {
    for (const shard of shards) {
      const assignment = shard.assignedToNode
        ? shard.executionFiles.length
          ? `${shard.executionFiles.length} file(s), estimated weight ${shard.estimatedWeight}`
          : 'whole job'
        : 'assigned to another node';
      process.stdout.write(`[assignment] ${shard.job.name} -> ${node.id}: ${assignment}\n`);
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
  const recordWithoutExecution = (shard, status, detail) => {
    state.set(shard.job.name, status);
    results.set(shard.job.name, {
      ...shard.resultBase, finishedAt: new Date().toISOString(), status, detail,
    });
  };
  for (const shard of shards) {
    shard.resultBase = {
      shardId: shard.id, jobName: shard.job.name, command: shard.historyCommand,
      nodeId: node.id, nodeCapacity: node.capacity, allocatedCapacity: 0,
      startedAt: null, durationMs: 0,
    };
    const detail = !shard.assignedToNode
      ? 'assigned to another configured node'
      : shard.job.when.length && !shard.selectedFiles.length
        ? 'no declared application paths changed'
        : null;
    if (!detail) continue;
    recordWithoutExecution(shard, 'not-needed', detail);
  }
  while ([...state.values()].some((status) => status === 'pending' || status === 'running')) {
    for (const shard of shards) {
      if (state.get(shard.job.name) !== 'pending') continue;
      const blockedBy = shard.job.after.find((dependency) =>
        ['failed', 'skipped', 'interrupted'].includes(state.get(dependency))
      );
      if (!blockedBy) continue;
      recordWithoutExecution(shard, 'skipped', `dependency ${blockedBy} did not pass`);
    }

    if (signal.aborted) {
      if (running.size)
        await Promise.all([...running.values()].map((entry) => entry.promise));
      for (const shard of shards) {
        if (state.get(shard.job.name) !== 'pending') continue;
        recordWithoutExecution(shard, 'interrupted', 'Vroom was interrupted');
      }
      break;
    }

    const ready = shards
      .filter((shard) => state.get(shard.job.name) === 'pending' &&
        shard.job.after.every((dependency) => ['passed', 'not-needed'].includes(state.get(dependency))))
      .sort((left, right) => (right.averageDurationMs ?? -1) - (left.averageDurationMs ?? -1) ||
        left.originalOrder - right.originalOrder);
    const runningEntries = [...running.values()];
    const runningExclusive = runningEntries.some((entry) => entry.exclusive);
    const readyExclusive = ready.find((shard) => shard.job.exclusive);
    let availableCapacity = node.capacity -
      runningEntries.reduce((total, entry) => total + entry.allocatedCapacity, 0);
    const starting = [];

    if (!runningExclusive && availableCapacity > 0) {
      if (readyExclusive) {
        if (!running.size)
          starting.push({ shard: readyExclusive, allocatedCapacity: node.capacity });
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
        } else if (workerBased.length > 0 && workerBased.every((shard) =>
          Number.isFinite(shard.averageWorkerMs) && shard.averageWorkerMs > 0)) {
          const allocations = workerBased.map((shard) => ({ shard, allocatedCapacity: 1 }));
          let unassignedCapacity = availableCapacity - allocations.length;
          while (unassignedCapacity > 0) {
            let bestIndex = 0;
            for (let index = 1; index < allocations.length; index += 1) {
              const candidate = allocations[index];
              const currentBest = allocations[bestIndex];
              const candidateDuration = candidate.shard.averageWorkerMs / candidate.allocatedCapacity;
              const bestDuration = currentBest.shard.averageWorkerMs / currentBest.allocatedCapacity;
              if (candidateDuration > bestDuration) bestIndex = index;
            }
            allocations[bestIndex].allocatedCapacity += 1;
            unassignedCapacity -= 1;
          }
          starting.push(...allocations);
          availableCapacity = 0;
        } else {
          for (let index = 0; index < workerBased.length && availableCapacity > 0; index += 1) {
            const shard = workerBased[index];
            const remainingWorkers = workerBased.length - index;
            const allocatedCapacity = Math.max(1, Math.floor(availableCapacity / remainingWorkers));
            starting.push({ shard, allocatedCapacity });
            availableCapacity -= allocatedCapacity;
          }
        }
      }
    }

    for (const { shard, allocatedCapacity } of starting) {
      state.set(shard.job.name, 'running');
      process.stdout.write(
        `[start] ${shard.job.name} -> ${node.id} (${allocatedCapacity} thread slot${allocatedCapacity === 1 ? '' : 's'})\n`
      );

      const execution = Controller({ mode, request: {
        applicationRoot: plan.applicationRoot, targetId, shard, node, allocatedCapacity,
        assignment: shard.assignment, signal,
      } });

      const tracked = execution.then((result) => {
        results.set(shard.job.name, result);
        state.set(shard.job.name, result.status);
        running.delete(shard.job.name);
        return result;
      });
      running.set(shard.job.name, { promise: tracked, allocatedCapacity, exclusive: shard.job.exclusive });
    }

    if (running.size)
      await Promise.race([...running.values()].map((entry) => entry.promise));
    else if ([...state.values()].some((status) => status === 'pending'))
      throw new Error('No runnable jobs remain; check workload dependencies and resource capacity');
  }

  const orderedResults = shards.map((shard) => results.get(shard.job.name));
  const timingOutcome = await TimingResults({
    ...timingRequest,
    action: 'save',
    mode,
    node,
    resources,
    results: orderedResults,
    history,
  });
  return { resources, ...timingOutcome };
}

// J. runVroom
// Owns end-to-end coordination and the final result. It connects functions A-I,
// installs and removes interruption and disconnect handlers, prints the final
// per-job summary and timing-log location, and returns the process exit code for
// success, failure, or interruption. It does not duplicate functions A-I.
async function runVroom() {
  const options = CliInterface(process.argv.slice(2));
  if (!options) return 0;

  const vroomConfiguration = await loadVroomConfiguration();
  const application = vroomConfiguration.applications.get(options.applicationId);
  if (!application)
    throw new Error(`Unsupported application id: ${options.applicationId}. Available: ${[
      ...vroomConfiguration.applications.keys()].join(', ')}`);
  const applicationRoot = resolve(options.executionMode === 'github' && !options.githubReturn
    ? application.githubPath : application.path);
  const configuration = await loadApplicationConfiguration(
    applicationRoot, options.workload, application.configurationFile,
    options.executionMode === 'local' || options.githubPlan);
  configuration.applicationId = application.id;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  process.on('SIGHUP', interrupt);

  try {
    const outcome = await Scheduler(configuration, options.executionMode, controller.signal,
      { githubPlan: options.githubPlan, vroomConfiguration });
    if (outcome.plannedOnly) {
      process.stdout.write(`\nVroom GitHub plan: ${outcome.resources.nodes.length} configured node(s)\n`);
      return 0;
    }
    process.stdout.write(`\nVroom result: ${configuration.workload}\n`);
    let passed = true;
    for (const result of outcome.results) {
      if (!['passed', 'not-needed'].includes(result.status)) passed = false;
      const duration = result.durationMs
        ? ` (${(Math.round(result.durationMs / 100) / 10).toFixed(1)}s)` : '';
      process.stdout.write(`  ${result.status.padEnd(11)} ${result.jobName}${duration}` +
        `${result.detail ? ` - ${result.detail}` : ''}\n`);
    }
    if (!outcome.timingLogPaths.length)
      process.stdout.write('Timing log: not created because no jobs were selected\n');
    else if (outcome.timingLogPaths.length === 1)
      process.stdout.write(`Timing log: ${outcome.timingLogPaths[0]}\n`);
    else {
      process.stdout.write('Timing logs:\n');
      for (const timingLogPath of outcome.timingLogPaths) process.stdout.write(`  ${timingLogPath}\n`);
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
