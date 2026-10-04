import {
  createProcessShutdownController,
  drainForShutdown,
} from '@server/utils/gracefulShutdown';
import { appendFileSync } from 'node:fs';
import http from 'node:http';

const markerPath = process.argv[2];
const mode = process.argv[3] ?? 'clean';

if (!markerPath) {
  throw new Error('A marker path is required');
}

const mark = (value: string) => appendFileSync(markerPath, `${value}\n`);

const server = http.createServer((_request, response) => {
  response.end('ok');
});

const heldWork = new Promise<void>((resolve) => {
  setTimeout(() => {
    mark('work-complete');
    resolve();
  }, 350);
});

createProcessShutdownController({
  onStart: () => mark('shutdown-started'),
  drain: () =>
    drainForShutdown({
      server,
      tasks: [
        {
          name: 'held work',
          run: async () => {
            await heldWork;
            if (mode === 'task-error') {
              throw new Error('held work failed');
            }
          },
        },
      ],
      connectionTimeoutMs: 1_000,
      taskTimeoutMs: 1_000,
    }),
  onComplete: (_result, failed) =>
    mark(failed ? 'drain-failed' : 'drain-complete'),
  onError: () => mark('drain-threw'),
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected an internet socket address');
  }
  mark('ready');
  process.stdout.write(`READY ${address.port}\n`);
});
