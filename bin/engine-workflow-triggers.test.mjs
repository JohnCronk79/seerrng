// Copyright (c) snapetech and SeerrNG contributors.
import * as yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const engineFiles = [
  'tools/validation-engine/runtime/controller.mjs',
  'tools/validation-engine/README.md',
  'tools/validation-engine/validation-engine-v1.1.0.tar.gz',
  'bin/engine-workflow-triggers.test.mjs',
  'bin/run-local-validation.mjs',
  'vitest.config.mts',
  'server/test/engine-isolate-before.mjs',
  'server/test/setup.ts',
  'server/test/vitest.setup.ts',
  'server/test/fixtures/shared.json',
  'package.json',
  'pnpm-lock.yaml',
];
const originals = {
  cypress: {
    branches: { pull_request: ['*'], push: ['main'] },
    paths: [
      'src/**',
      'server/**',
      'config/**',
      'cypress/**',
      'scripts/export-external-config.mjs',
      'cypress.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'next.config.ts',
      'tsconfig.json',
      '.github/workflows/cypress.yml',
    ],
    samples: [
      'src/index.tsx',
      'server/index.ts',
      'config/settings.json',
      'cypress/e2e/user.cy.ts',
    ],
  },
  'test-docs': {
    branches: { pull_request: ['main'], push: ['main'] },
    paths: ['docs/**', 'gen-docs/**', '.github/workflows/test-docs.yml'],
    samples: [
      'docs/guide.mdx',
      'gen-docs/src/parser.mjs',
      '.github/workflows/test-docs.yml',
    ],
  },
  'docs-link-check': {
    branches: { pull_request: ['*'], push: ['main'] },
    paths: ['docs/**', 'gen-docs/**', '.github/workflows/docs-link-check.yml'],
    samples: [
      'docs/guide.md',
      'gen-docs/guide.mdx',
      '.github/workflows/docs-link-check.yml',
    ],
  },
  codeql: {
    branches: { pull_request: ['main'], push: ['main'] },
    paths: ['**', '!**/*.md', '!docs/**'],
    samples: [
      'src/index.tsx',
      'server/index.ts',
      '.github/workflows/ci.yml',
      'gen-docs/src/parser.mjs',
    ],
  },
};
function selects(patterns, file) {
  let selected = false;
  for (const pattern of patterns) {
    const excluded = pattern.startsWith('!');
    // These workflows use literal paths, * and **. GitHub includes dot paths;
    // filesystem globs with an implicit dot exclusion are not equivalent.
    const expression = (excluded ? pattern.slice(1) : pattern)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/|\*\*|\*/g, (wildcard) =>
        wildcard === '**/' ? '(?:.*/)?' : wildcard === '**' ? '.*' : '[^/]*'
      );
    if (new RegExp(`^${expression}$`).test(file)) selected = !excluded;
  }
  return selected;
}
for (const [name, original] of Object.entries(originals)) {
  const bytes = readFileSync(
    path.join(root, '.github/workflows', `${name}.yml`),
    'utf8'
  ).replaceAll('\r\n', '\n');
  const workflow = yaml.load(bytes);
  for (const event of Object.keys(original.branches)) {
    test(`${name} ${event} selects engine changes and retains original path coverage`, () => {
      const filter = workflow.on[event];
      assert.deepEqual(filter.branches, original.branches[event]);
      assert.equal(filter['paths-ignore'], undefined);
      for (const pattern of original.paths)
        assert.ok(
          filter.paths.includes(pattern),
          `${name}/${event}: ${pattern}`
        );
      if (name === 'codeql')
        assert.deepEqual(filter.paths.slice(0, 3), original.paths);
      for (const file of [...engineFiles, ...original.samples])
        assert.equal(
          selects(filter.paths, file),
          true,
          `${name}/${event}: ${file}`
        );
      for (const file of [
        'README.md',
        'licenses/example.md',
        'notes/unrelated.md',
        '.github/unrelated.md',
      ])
        assert.equal(
          selects(filter.paths, file),
          false,
          `${name}/${event}: ${file}`
        );
      if (name === 'codeql') {
        for (const file of [
          'docs/api/schema.json',
          'docs/guide.mdx',
          'docs/guide.md',
        ])
          assert.equal(selects(filter.paths, file), false, file);
      } else if (name !== 'cypress') {
        assert.equal(selects(filter.paths, 'src/unrelated.tsx'), false);
      }
    });
  }
}
