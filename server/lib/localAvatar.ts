import { appDataPath } from '@server/utils/appDataVolume';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const LOCAL_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const LOCAL_AVATAR_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const LOCAL_AVATAR_SIZE = 512;
const LOCAL_AVATAR_DIRECTORY = 'avatars';
const LOCAL_AVATAR_VERSION_PATTERN = /^[a-f0-9]{64}$/;

export class InvalidLocalAvatarError extends Error {}

const getLocalAvatarDirectory = (): string =>
  path.join(appDataPath(), LOCAL_AVATAR_DIRECTORY);

const getLocalAvatarFilename = (userId: number, version: string): string =>
  `user-${userId}-${version}.webp`;

export const getLocalAvatarUrl = (userId: number, version: string): string =>
  `/avatarproxy/local/${userId}?v=${version}`;

export const getLocalAvatarFilePath = (
  userId: number,
  version: string
): string | undefined => {
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !LOCAL_AVATAR_VERSION_PATTERN.test(version)
  ) {
    return undefined;
  }

  return path.join(
    getLocalAvatarDirectory(),
    getLocalAvatarFilename(userId, version)
  );
};

export const prepareLocalAvatar = async (input: Buffer): Promise<Buffer> => {
  if (!input.length || input.length > LOCAL_AVATAR_MAX_BYTES) {
    throw new InvalidLocalAvatarError('Invalid profile picture size.');
  }

  try {
    const source = sharp(input, {
      animated: false,
      failOn: 'error',
      limitInputPixels: 40_000_000,
    });
    const metadata = await source.metadata();

    if (
      !metadata.format ||
      !['jpeg', 'png', 'webp'].includes(metadata.format)
    ) {
      throw new InvalidLocalAvatarError(
        'Profile pictures must be JPEG, PNG, or WebP images.'
      );
    }

    return await source
      .rotate()
      .resize(LOCAL_AVATAR_SIZE, LOCAL_AVATAR_SIZE, {
        fit: 'cover',
        position: 'attention',
      })
      .webp({ quality: 88 })
      .toBuffer();
  } catch (error) {
    if (error instanceof InvalidLocalAvatarError) {
      throw error;
    }
    throw new InvalidLocalAvatarError(
      'The selected file is not a valid profile picture.'
    );
  }
};

export const storeLocalAvatar = async (
  userId: number,
  input: Buffer
): Promise<{ url: string; version: string }> => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new InvalidLocalAvatarError('Invalid user ID.');
  }

  const image = await prepareLocalAvatar(input);
  const version = createHash('sha256').update(image).digest('hex');
  const avatarPath = getLocalAvatarFilePath(userId, version);
  if (!avatarPath) {
    throw new InvalidLocalAvatarError('Invalid profile picture path.');
  }

  await mkdir(getLocalAvatarDirectory(), { recursive: true });
  try {
    await writeFile(avatarPath, image, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  return {
    url: getLocalAvatarUrl(userId, version),
    version,
  };
};

export const readLocalAvatar = async (
  userId: number,
  version: string
): Promise<Buffer | undefined> => {
  const avatarPath = getLocalAvatarFilePath(userId, version);
  if (!avatarPath) {
    return undefined;
  }

  try {
    return await readFile(avatarPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

export const removeLocalAvatarFiles = async (
  userId: number,
  keepVersion?: string
): Promise<void> => {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return;
  }

  let entries;
  try {
    entries = await readdir(getLocalAvatarDirectory(), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const keepFilename = keepVersion
    ? getLocalAvatarFilename(userId, keepVersion)
    : undefined;
  const userFilenamePattern = new RegExp(
    `^user-${userId}-[a-f0-9]{64}\\.webp$`
  );

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name !== keepFilename &&
          userFilenamePattern.test(entry.name)
      )
      .map(async (entry) => {
        try {
          await unlink(path.join(getLocalAvatarDirectory(), entry.name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      })
  );
};
