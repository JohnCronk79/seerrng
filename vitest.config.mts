import { transform } from '@swc/core';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const include = [
  'server/**/*.test.ts',
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'src/**/*.vitest.test.ts',
];
const exclude = ['node_modules/**', 'dist/**'];

const swcTypeScriptDecorators = {
  name: 'swc-typescript-decorators',
  enforce: 'pre' as const,
  async transform(code: string, id: string) {
    const filePath = id.split('?')[0];
    if (
      !filePath.includes('/server/') ||
      !/\.(?:ts|tsx)$/.test(filePath) ||
      filePath.endsWith('.d.ts') ||
      filePath.includes('/node_modules/')
    ) {
      return undefined;
    }

    const result = await transform(code, {
      filename: filePath,
      jsc: {
        parser: {
          decorators: true,
          dynamicImport: true,
          syntax: 'typescript',
          tsx: filePath.endsWith('.tsx'),
        },
        target: 'es2020',
        transform: {
          decoratorMetadata: true,
          legacyDecorator: true,
          useDefineForClassFields: false,
        },
      },
      module: { type: 'es6' },
      sourceMaps: true,
    });

    return { code: result.code, map: result.map };
  },
};

export default defineConfig({
  plugins: [swcTypeScriptDecorators],
  resolve: {
    alias: {
      '@server': resolve(projectRoot, 'server'),
      '@app': resolve(projectRoot, 'src'),
      'node:test': resolve(projectRoot, 'server/test/vitestNodeTest.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [
      './server/test/vitest-isolate-before.mjs',
      './server/test/vitest.setup.ts',
    ],
    include,
    exclude,
    passWithNoTests: false,
    pool: 'forks',
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.vitest.test.ts',
      ],
    },
  },
});
