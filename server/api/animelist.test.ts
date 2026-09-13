import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, type TestContext } from 'node:test';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';

import {
  MAX_ANIME_MAPPING_ENTRIES,
  MAX_MAPPING_FILE_BYTES,
  assertMappingFileSize,
  createSizeLimitTransform,
  parseAnimeListMappings,
  readMappingFile,
  writeMappingFileAtomically,
} from './animelist';

const temporaryDirectories: string[] = [];

const createSymlinkOrSkip = async (
  t: TestContext,
  target: string,
  symlinkPath: string,
  type?: 'dir' | 'file' | 'junction'
) => {
  try {
    await fs.symlink(target, symlinkPath, type);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform === 'win32' &&
      ['EPERM', 'EACCES'].includes(code ?? '')
    ) {
      t.skip(
        'Windows has not granted this process permission to create symlinks'
      );
      return false;
    }
    throw error;
  }
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

const readLimitedStream = async (chunks: Buffer[], maxBytes: number) => {
  const output: Buffer[] = [];
  await pipeline(
    Readable.from(chunks),
    createSizeLimitTransform(maxBytes),
    new Writable({
      write(chunk, _encoding, callback) {
        output.push(Buffer.from(chunk));
        callback();
      },
    })
  );

  return Buffer.concat(output);
};

describe('createSizeLimitTransform', () => {
  it('passes downloads within the byte limit', async () => {
    const result = await readLimitedStream(
      [Buffer.from('anime'), Buffer.from('-list')],
      10
    );

    assert.equal(result.toString(), 'anime-list');
  });

  it('rejects downloads that exceed the byte limit', async () => {
    await assert.rejects(
      readLimitedStream([Buffer.from('anime'), Buffer.from('-list')], 9),
      /download exceeds maximum size/
    );
  });
});

describe('assertMappingFileSize', () => {
  it('allows local mapping files within the byte limit', () => {
    assert.doesNotThrow(() => assertMappingFileSize(MAX_MAPPING_FILE_BYTES));
  });

  it('rejects oversized local mapping files before reading them', () => {
    assert.throws(
      () => assertMappingFileSize(MAX_MAPPING_FILE_BYTES + 1),
      /mapping file exceeds maximum size/
    );
  });
});

describe('mapping file I/O', () => {
  it('does not follow a predictable staging symlink', async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seerr-anime-list-')
    );
    temporaryDirectories.push(directory);
    const mappingPath = path.join(directory, 'anime-list.xml');
    const unrelatedPath = path.join(directory, 'unrelated');
    const predictableTempPath = `${mappingPath}.tmp`;
    await fs.writeFile(unrelatedPath, 'do not overwrite');
    if (!(await createSymlinkOrSkip(t, unrelatedPath, predictableTempPath))) {
      return;
    }

    await writeMappingFileAtomically(
      Readable.from(['<anime-list />']),
      mappingPath
    );

    assert.equal(await fs.readFile(unrelatedPath, 'utf8'), 'do not overwrite');
    assert.equal(await fs.readFile(mappingPath, 'utf8'), '<anime-list />');
    assert.equal((await fs.stat(mappingPath)).mode & 0o777, 0o600);
  });

  it('rejects symlinked mapping files during reads', async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'seerr-anime-list-')
    );
    temporaryDirectories.push(directory);
    const mappingPath = path.join(directory, 'anime-list.xml');
    const targetPath = path.join(directory, 'target.xml');
    await fs.writeFile(targetPath, '<anime-list />');
    if (!(await createSymlinkOrSkip(t, targetPath, mappingPath))) {
      return;
    }

    await assert.rejects(readMappingFile(mappingPath), /ELOOP|symlink/i);
  });

  it('rejects symlinks above the mapping directory', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-anime-list-'));
    temporaryDirectories.push(root);
    const targetRoot = path.join(root, 'target');
    const targetDirectory = path.join(targetRoot, 'nested');
    const linkedRoot = path.join(root, 'linked');
    await fs.mkdir(targetDirectory, { recursive: true });
    await fs.writeFile(
      path.join(targetDirectory, 'anime-list.xml'),
      '<anime-list />'
    );
    if (!(await createSymlinkOrSkip(t, targetRoot, linkedRoot, 'dir'))) {
      return;
    }
    const mappingPath = path.join(linkedRoot, 'nested', 'anime-list.xml');

    await assert.rejects(readMappingFile(mappingPath), /symlink/i);
    await assert.rejects(
      writeMappingFileAtomically(Readable.from(['changed']), mappingPath),
      /symlink/i
    );
  });
});

describe('parseAnimeListMappings', () => {
  it('normalizes provider IDs and bounded special mappings', () => {
    const parsed = parseAnimeListMappings({
      'anime-list': {
        anime: [
          null,
          { $: { anidbid: 'bad' } },
          {
            $: {
              anidbid: '1',
              tvdbid: '2',
              tmdbid: '3',
              imdbid: 'tt123,invalid,tt456',
              defaulttvdbseason: '0',
            },
            'mapping-list': [
              {
                mapping: [
                  { $: { anidbseason: '1', tvdbseason: '0' }, _: ';1-5' },
                  { $: { anidbseason: '1', tvdbseason: '1' }, _: ';1-6' },
                  null,
                ],
              },
            ],
          },
        ],
      },
    });

    assert.deepStrictEqual(parsed.mapping[1], {
      tvdbId: undefined,
      tmdbId: 3,
      imdbId: 'tt123',
      tvdbSeason: 0,
    });
    assert.deepStrictEqual(parsed.specials[2][5], {
      tmdbId: 3,
      imdbId: 'tt123',
    });
  });

  it('rejects oversized documents and malformed roots', () => {
    assert.throws(
      () =>
        parseAnimeListMappings({
          'anime-list': {
            anime: Array.from({ length: MAX_ANIME_MAPPING_ENTRIES + 1 }),
          },
        }),
      /too many entries/
    );
    assert.throws(() => parseAnimeListMappings({}), /entries are invalid/);
  });
});
