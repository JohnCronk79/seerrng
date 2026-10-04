type ErrorWithStatus = {
  response?: { status?: unknown };
  status?: unknown;
  statusCode?: unknown;
};

const getErrorStatus = (error: unknown): unknown => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as ErrorWithStatus;
  return candidate.response?.status ?? candidate.status ?? candidate.statusCode;
};

export const isAuthenticationError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  return status === 401 || status === 403;
};
