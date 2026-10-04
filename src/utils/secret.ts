export const REDACTED_SECRET = '[REDACTED]';

export const isRedactedSecret = (value: unknown): boolean =>
  value === REDACTED_SECRET;
