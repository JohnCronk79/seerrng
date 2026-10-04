import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const resolveBash = () => {
  if (process.platform !== 'win32') {
    return 'bash';
  }

  const candidates = [];
  try {
    const gitExecPath = execFileSync('git', ['--exec-path'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    candidates.push(
      path.resolve(gitExecPath, '..', '..', '..', 'bin', 'bash.exe')
    );
  } catch {
    // Fall through to conventional Git for Windows locations.
  }
  candidates.push(
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  );

  const bash = candidates.find((candidate) => fs.existsSync(candidate));
  if (!bash) {
    throw new Error(
      'Git Bash is required to run the POSIX validation scripts on Windows.'
    );
  }
  return bash;
};

export const withGitBashOnPath = (environment = process.env) => {
  if (process.platform !== 'win32') {
    return { ...environment };
  }

  const bashDirectory = path.dirname(resolveBash());
  const gitRoot = path.dirname(bashDirectory);
  const unixToolsDirectory = path.join(gitRoot, 'usr', 'bin');
  const wingetPackages = path.join(
    environment.LOCALAPPDATA ?? '',
    'Microsoft',
    'WinGet',
    'Packages'
  );
  let helmDirectory;
  try {
    const helmPackage = fs
      .readdirSync(wingetPackages, { withFileTypes: true })
      .find(
        (entry) => entry.isDirectory() && entry.name.startsWith('Helm.Helm_')
      );
    if (helmPackage) {
      const candidate = path.join(
        wingetPackages,
        helmPackage.name,
        'windows-amd64'
      );
      if (fs.existsSync(path.join(candidate, 'helm.exe'))) {
        helmDirectory = candidate;
      }
    }
  } catch {
    // Helm remains optional outside the chart validation suite.
  }
  return {
    ...environment,
    PATH: [bashDirectory, unixToolsDirectory, helmDirectory, environment.PATH]
      .filter(Boolean)
      .join(path.delimiter),
  };
};
