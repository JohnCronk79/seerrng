import { ApiErrorCode } from '@server/constants/error';

export type ApiErrorResponseInput = {
  message?: string;
  errors?: unknown[];
  error?: string;
};

const apiErrorCodes = new Set<string>(Object.values(ApiErrorCode));

const getPublicErrorCode = (error: unknown): string | undefined =>
  typeof error === 'string' && apiErrorCodes.has(error) ? error : undefined;

export const getRequestLogPath = (originalUrl: string): string =>
  originalUrl.split('?', 1)[0];

export const normalizeApiErrorStatus = (status: unknown): number =>
  typeof status === 'number' &&
  Number.isInteger(status) &&
  status >= 200 &&
  status <= 599
    ? status
    : 500;

export const formatApiErrorResponse = (
  error: ApiErrorResponseInput,
  status: number
): ApiErrorResponseInput => {
  const publicErrorCode = getPublicErrorCode(error.error);

  if (status >= 500) {
    return {
      message: 'Internal server error.',
      ...(publicErrorCode ? { error: publicErrorCode } : {}),
    };
  }

  return {
    message: error.message,
    errors: error.errors,
    ...(publicErrorCode ? { error: publicErrorCode } : {}),
  };
};
