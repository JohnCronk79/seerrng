import assert from 'node:assert/strict';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { describe, it } from 'node:test';

type FixtureChild = ChildProcessByStdio<null, Readable, Readable>;

const posixDescribe = process.platform === 'win32' ? describe.skip : describe;

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_PATH = path.join(
  REPO_ROOT,
  'server/test/fixtures/gracefulShutdownProcess.ts'
);

const waitForReady = (child: FixtureChild): Promise<number> =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(
      () => reject(new Error(`Child did not become ready: ${stderr}`)),
      5_000
    );
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const match = /^READY (\d+)$/m.exec(stdout);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Child exited before ready (code ${code}, signal ${signal}): ${stderr}`
        )
      );
    });
  });

const canConnect = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/', timeout: 250 },
      (response) => {
        response.resume();
        response.once('end', () => resolve(true));
      }
    );
    request.once('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.once('error', () => resolve(false));
  });

const waitUntil = async (condition: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (!(await condition())) {
    if (Date.now() >= deadline) {
      throw new Error('Condition was not met before timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const startFixture = (markerPath: string, mode = 'clean') =>
  spawn(
    process.execPath,
    [
      '-r',
      require.resolve('ts-node/register'),
      '-r',
      require.resolve('tsconfig-paths/register'),
      FIXTURE_PATH,
      markerPath,
      mode,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TS_NODE_FILES: 'true',
        TS_NODE_PROJECT: path.join(REPO_ROOT, 'server/tsconfig.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

const stopChild = async (child: FixtureChild) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
};

posixDescribe('process shutdown integration', () => {
  it('stops admission, drains held work, and exits successfully on SIGTERM', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seerr-shutdown-')
    );
    const markerPath = path.join(directory, 'markers');
    const child = startFixture(markerPath);

    try {
      const port = await waitForReady(child);
      assert.strictEqual(await canConnect(port), true);
      assert.strictEqual(child.kill('SIGTERM'), true);

      await waitUntil(async () => !(await canConnect(port)));
      assert.strictEqual(child.exitCode, null);

      const [code, signal] = (await once(child, 'exit')) as [
        number | null,
        NodeJS.Signals | null,
      ];
      assert.strictEqual(code, 0);
      assert.strictEqual(signal, null);
      assert.deepEqual(
        (await fs.readFile(markerPath, 'utf8')).trim().split('\n'),
        ['ready', 'shutdown-started', 'work-complete', 'drain-complete']
      );
    } finally {
      await stopChild(child);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('returns a failure status when drained work fails', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seerr-shutdown-')
    );
    const markerPath = path.join(directory, 'markers');
    const child = startFixture(markerPath, 'task-error');

    try {
      await waitForReady(child);
      assert.strictEqual(child.kill('SIGTERM'), true);
      const [code, signal] = (await once(child, 'exit')) as [
        number | null,
        NodeJS.Signals | null,
      ];

      assert.strictEqual(code, 1);
      assert.strictEqual(signal, null);
      assert.deepEqual(
        (await fs.readFile(markerPath, 'utf8')).trim().split('\n'),
        ['ready', 'shutdown-started', 'work-complete', 'drain-failed']
      );
    } finally {
      await stopChild(child);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
