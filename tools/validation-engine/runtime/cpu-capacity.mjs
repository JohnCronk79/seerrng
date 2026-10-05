import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';

const HIGH_THROUGHPUT_GITHUB_LOGINS = new Map([['johncronk79', 'JohnCronk79']]);

const approvedGithubLogin = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return HIGH_THROUGHPUT_GITHUB_LOGINS.get(value.trim().toLowerCase()) ?? null;
};

const githubLoginFromNoreplyEmail = (value) => {
  if (typeof value !== 'string') return null;
  const match = value
    .trim()
    .match(/^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/i);
  return match ? approvedGithubLogin(match[1]) : null;
};

export function resolveOperatorGithubLogin({
  environment = {},
  gitConfig = () => null,
} = {}) {
  for (const value of [
    environment.GITHUB_TRIGGERING_ACTOR,
    environment.GITHUB_ACTOR,
  ]) {
    if (typeof value === 'string' && value.trim() !== '')
      return approvedGithubLogin(value);
  }
  const configuredGithubUser = gitConfig('github.user');
  if (
    typeof configuredGithubUser === 'string' &&
    configuredGithubUser.trim() !== ''
  ) {
    return approvedGithubLogin(configuredGithubUser);
  }
  const emailLogin = githubLoginFromNoreplyEmail(gitConfig('user.email'));
  if (emailLogin) return emailLogin;
  return approvedGithubLogin(gitConfig('user.name'));
}

export function detectOperatorGithubLogin({
  sourceRoot = process.cwd(),
  environment = process.env,
} = {}) {
  const gitConfig = (key) => {
    try {
      return (
        execFileSync('git', ['-C', sourceRoot, 'config', '--get', key], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null
      );
    } catch {
      return null;
    }
  };
  return resolveOperatorGithubLogin({ environment, gitConfig });
}

// OS logical capacity, not physical cores, observed workers, or performance.
export function selectWorkerCapacity({
  availableLogicalCpus,
  visibleLogicalCpus = availableLogicalCpus,
  quotaCpus = null,
  override = null,
  operatorGithubLogin = null,
  githubActions = false,
}) {
  if (typeof githubActions !== 'boolean')
    throw new Error('GitHub Actions context must be boolean');
  if (
    !Number.isSafeInteger(availableLogicalCpus) ||
    availableLogicalCpus < 1 ||
    !Number.isSafeInteger(visibleLogicalCpus) ||
    visibleLogicalCpus < 1 ||
    (quotaCpus !== null && (!Number.isFinite(quotaCpus) || quotaCpus <= 0))
  )
    throw new Error('Invalid actual CPU capacity');
  const effectiveLogicalCpus = Math.min(
    availableLogicalCpus,
    visibleLogicalCpus,
    quotaCpus === null
      ? availableLogicalCpus
      : Math.max(1, Math.floor(quotaCpus))
  );
  if (
    override !== null &&
    (!Number.isSafeInteger(override) || override < 1 || override > 256)
  )
    throw new Error('Worker override must be an integer1..256');
  const approvedOperatorGithubLogin = approvedGithubLogin(operatorGithubLogin);
  const highThroughput = approvedOperatorGithubLogin !== null;
  const automaticWorkers = githubActions
    ? effectiveLogicalCpus
    : highThroughput
      ? effectiveLogicalCpus * 2
      : Math.max(1, effectiveLogicalCpus - 1);
  return {
    availableLogicalCpus,
    visibleLogicalCpus,
    quotaCpus,
    effectiveLogicalCpus,
    operatorGithubLogin: approvedOperatorGithubLogin,
    githubActions,
    policy:
      override !== null
        ? 'explicit-worker-override'
        : githubActions
          ? 'one-worker-per-effective-logical-cpu-on-github-actions'
          : highThroughput
            ? 'two-workers-per-effective-logical-cpu-for-approved-operator'
            : 'one-worker-less-than-effective-logical-cpus',
    configuredWorkers: override ?? automaticWorkers,
    observedWorkerCount: null,
  };
}

export function detectWorkerCapacity(options = {}) {
  if (options === null || Number.isSafeInteger(options))
    options = { override: options };
  if (typeof options !== 'object' || Array.isArray(options))
    throw new Error(
      'Worker capacity options must be an object, integer, or null'
    );
  const {
    override = null,
    sourceRoot = process.cwd(),
    operatorGithubLogin = null,
    environment = process.env,
  } = options;
  let quotaCpus = null;
  if (process.platform === 'linux') {
    let quota;
    try {
      quota = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8')
        .trim()
        .split(/\s+/);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (quota) {
      if (
        quota.length !== 2 ||
        !Number.isFinite(Number(quota[1])) ||
        Number(quota[1]) <= 0
      )
        throw new Error('Invalid cgroup CPU quota');
      if (quota[0] !== 'max') quotaCpus = Number(quota[0]) / Number(quota[1]);
    } else {
      try {
        const amount = Number(
          readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8')
        );
        const period = Number(
          readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8')
        );
        if (amount !== -1) {
          if (!(period > 0)) throw new Error('Invalid legacy CPU quota');
          quotaCpus = amount / period;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const detectedOperatorGithubLogin =
    operatorGithubLogin ??
    detectOperatorGithubLogin({ sourceRoot, environment });
  return selectWorkerCapacity({
    availableLogicalCpus: availableParallelism(),
    visibleLogicalCpus: cpus().length,
    quotaCpus,
    override,
    operatorGithubLogin: detectedOperatorGithubLogin,
    githubActions: environment.GITHUB_ACTIONS === 'true',
  });
}
