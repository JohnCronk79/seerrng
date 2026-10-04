export const isUniqueConstraintError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as {
    code?: unknown;
    message?: unknown;
    driverError?: { code?: unknown; message?: unknown };
  };
  const code = String(record.driverError?.code ?? record.code ?? '');
  const message = String(record.driverError?.message ?? record.message ?? '');
  return (
    code === '23505' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (code === 'SQLITE_CONSTRAINT' && /UNIQUE constraint failed/i.test(message))
  );
};
