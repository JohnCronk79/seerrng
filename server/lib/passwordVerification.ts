import { BoundedTaskQueue } from '@server/utils/concurrency';
import bcrypt from 'bcrypt';

export const LOCAL_PASSWORD_VERIFICATION_CONCURRENCY = 4;
export const MAX_QUEUED_LOCAL_PASSWORD_VERIFICATIONS = 32;

type PasswordCompare = (password: string, hash: string) => Promise<boolean>;

export const createBoundedPasswordVerifier = (
  compare: PasswordCompare,
  {
    concurrency = LOCAL_PASSWORD_VERIFICATION_CONCURRENCY,
    maxQueued = MAX_QUEUED_LOCAL_PASSWORD_VERIFICATIONS,
  }: { concurrency?: number; maxQueued?: number } = {}
): ((password: string, hash: string) => Promise<boolean>) => {
  const queue = new BoundedTaskQueue(concurrency, maxQueued);
  return (password, hash) => queue.run(() => compare(password, hash));
};

export const verifyLocalPassword = createBoundedPasswordVerifier(
  (password, hash) => bcrypt.compare(password, hash)
);
