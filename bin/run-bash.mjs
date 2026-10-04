import { spawnSync } from 'node:child_process';
import { resolveBash, withGitBashOnPath } from './platform-tools.mjs';

const [script, ...arguments_] = process.argv.slice(2);
if (!script) {
  console.error('Usage: node bin/run-bash.mjs <script> [arguments...]');
  process.exit(2);
}

const result = spawnSync(resolveBash(), [script, ...arguments_], {
  env: withGitBashOnPath(),
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
