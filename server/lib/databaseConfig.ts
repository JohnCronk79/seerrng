import fs from 'node:fs';

export const MAX_DATABASE_TLS_FILE_BYTES = 1024 * 1024;
export const MAX_POSTGRES_POOL_SIZE = 100;

export const parseBooleanConfig = (
  name: string,
  value: string | undefined,
  defaultValue = false
): boolean => {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  switch (value.toLowerCase()) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      throw new Error(`${name} must be either "true" or "false"`);
  }
};

export const parseIntegerConfig = (
  name: string,
  value: string | undefined,
  defaultValue: number,
  { min, max }: { min: number; max: number }
): number => {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${name} must be a decimal integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
};

export const readDatabaseTlsFile = (filePath: string): Buffer => {
  // Secret mounts commonly expose certificates through symlinks. Resolve the
  // intended target, then prevent a final-component symlink race when opening.
  const resolvedPath = fs.realpathSync(filePath);
  const descriptor = fs.openSync(
    resolvedPath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  );

  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error('Database TLS material must be a regular file');
    }
    if (stat.size > MAX_DATABASE_TLS_FILE_BYTES) {
      throw new Error(
        `Database TLS material exceeds ${MAX_DATABASE_TLS_FILE_BYTES} bytes`
      );
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_DATABASE_TLS_FILE_BYTES) {
      const buffer = Buffer.allocUnsafe(
        Math.min(64 * 1024, MAX_DATABASE_TLS_FILE_BYTES + 1 - totalBytes)
      );
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        return Buffer.concat(chunks, totalBytes);
      }
      chunks.push(buffer.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }

    throw new Error(
      `Database TLS material exceeds ${MAX_DATABASE_TLS_FILE_BYTES} bytes`
    );
  } finally {
    fs.closeSync(descriptor);
  }
};
