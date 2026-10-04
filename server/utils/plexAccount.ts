import { USER_SETTINGS_LIMITS } from '@server/constants/userSettings';
import { parsePositiveRouteId } from '@server/utils/routeId';
import {
  parseBoundedString,
  parseOptionalBoundedString,
} from '@server/utils/validation';
import validator from 'validator';

const MAX_PLEX_ACCOUNT_ID = 2_147_483_647;
const MAX_PLEX_TOKEN_LENGTH = 4096;

export type PlexAccountIdentity = {
  id: number;
  email: string;
  username?: string;
  thumb?: string;
  authToken: string;
};

export const parsePlexAccountIdentity = (
  value: unknown,
  fallbackAuthToken: string
): { value: PlexAccountIdentity } | { error: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Plex returned an invalid account identity.' };
  }

  const account = value as Record<string, unknown>;
  const id = parsePositiveRouteId(account.id, MAX_PLEX_ACCOUNT_ID);
  const email = parseBoundedString(account.email, {
    fieldName: 'Plex email',
    maxLength: USER_SETTINGS_LIMITS.email,
  });
  const username = parseOptionalBoundedString(account.username, {
    fieldName: 'Plex username',
    maxLength: USER_SETTINGS_LIMITS.username,
  });
  const thumb = parseOptionalBoundedString(account.thumb, {
    fieldName: 'Plex avatar',
    maxLength: USER_SETTINGS_LIMITS.avatar,
  });
  const authToken = parseOptionalBoundedString(account.authToken, {
    fieldName: 'Plex authentication token',
    maxLength: MAX_PLEX_TOKEN_LENGTH,
  });

  if (
    !id ||
    'error' in email ||
    !validator.isEmail(email.value, { require_tld: false }) ||
    'error' in username ||
    'error' in thumb ||
    'error' in authToken
  ) {
    return { error: 'Plex returned an invalid account identity.' };
  }

  return {
    value: {
      id,
      email: email.value.toLowerCase(),
      username: username.value,
      thumb: thumb.value,
      authToken: authToken.value ?? fallbackAuthToken,
    },
  };
};
