import { USER_SETTINGS_LIMITS } from '@server/constants/userSettings';
import { isValidHttpUrl } from '@server/utils/security';
import {
  parseBoundedString,
  parseOptionalBoundedString,
} from '@server/utils/validation';
import validator from 'validator';

const MAX_OIDC_SUBJECT_LENGTH = 255;

export type OidcIdentity = {
  sub: string;
  email?: string;
  username?: string;
  picture?: string;
};

export const parseOidcIdentity = (
  claims: Record<string, unknown>
): { value: OidcIdentity } | { error: string } => {
  const sub = parseBoundedString(claims.sub, {
    fieldName: 'OIDC subject',
    maxLength: MAX_OIDC_SUBJECT_LENGTH,
  });
  if ('error' in sub) {
    return { error: 'OIDC provider returned an invalid subject.' };
  }

  const email = parseOptionalBoundedString(claims.email, {
    fieldName: 'OIDC email',
    maxLength: USER_SETTINGS_LIMITS.email,
  });
  const username = parseOptionalBoundedString(claims.preferred_username, {
    fieldName: 'OIDC username',
    maxLength: USER_SETTINGS_LIMITS.username,
  });
  const picture = parseOptionalBoundedString(claims.picture, {
    fieldName: 'OIDC picture',
    maxLength: USER_SETTINGS_LIMITS.avatar,
  });

  return {
    value: {
      sub: sub.value,
      email:
        !('error' in email) &&
        email.value &&
        validator.isEmail(email.value, { require_tld: false })
          ? email.value.toLowerCase()
          : undefined,
      username: 'error' in username ? undefined : username.value,
      picture:
        !('error' in picture) && picture.value && isValidHttpUrl(picture.value)
          ? picture.value
          : undefined,
    },
  };
};
