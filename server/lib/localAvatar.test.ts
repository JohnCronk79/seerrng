import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import sharp from 'sharp';

import {
  InvalidLocalAvatarError,
  LOCAL_AVATAR_MAX_BYTES,
  getLocalAvatarFilePath,
  getLocalAvatarUrl,
  prepareLocalAvatar,
} from './localAvatar';

describe('local profile pictures', () => {
  it('normalizes uploaded pictures to square WebP images', async () => {
    const source = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: { r: 120, g: 40, b: 180 },
      },
    })
      .png()
      .toBuffer();

    const avatar = await prepareLocalAvatar(source);
    const metadata = await sharp(avatar).metadata();

    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
  });

  it('rejects non-image and oversized input', async () => {
    await assert.rejects(
      prepareLocalAvatar(Buffer.from('not-an-image')),
      InvalidLocalAvatarError
    );
    await assert.rejects(
      prepareLocalAvatar(Buffer.alloc(LOCAL_AVATAR_MAX_BYTES + 1)),
      InvalidLocalAvatarError
    );
  });

  it('builds versioned URLs and rejects unsafe storage versions', () => {
    const version = 'a'.repeat(64);
    assert.equal(
      getLocalAvatarUrl(7, version),
      `/avatarproxy/local/7?v=${version}`
    );
    assert.ok(getLocalAvatarFilePath(7, version)?.endsWith('.webp'));
    assert.equal(getLocalAvatarFilePath(7, '../unsafe'), undefined);
    assert.equal(getLocalAvatarFilePath(-1, version), undefined);
  });
});
