import NavidromeAPI from '@server/api/navidrome';
import { Permission } from '@server/lib/permissions';
import type { NavidromeSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import {
  REDACTED_SECRET,
  isValidHttpUrl,
  redactSecrets,
} from '@server/utils/security';
import {
  parseBoundedString,
  parseOptionalBoundedString,
} from '@server/utils/validation';
import { Router } from 'express';

const routes = Router();

/** Validates a request body. A redacted password keeps the saved password. */
export const parseNavidromeSettings = (
  body: unknown,
  current?: NavidromeSettings | null
): { value: NavidromeSettings } | { error: string } => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Settings must be an object.' };
  }
  const record = body as Record<string, unknown>;

  const url = parseBoundedString(record.url, {
    fieldName: 'url',
    maxLength: 512,
  });
  if ('error' in url) return url;
  if (!isValidHttpUrl(url.value)) {
    return { error: 'Navidrome URL must be a valid HTTP or HTTPS address.' };
  }

  const username = parseBoundedString(record.username, {
    fieldName: 'username',
    maxLength: 256,
  });
  if ('error' in username) return username;

  const passwordInput = parseOptionalBoundedString(record.password, {
    fieldName: 'password',
    maxLength: 512,
  });
  if ('error' in passwordInput) return passwordInput;
  const password =
    passwordInput.value === REDACTED_SECRET
      ? (current?.password ?? '')
      : (passwordInput.value ?? '');
  if (!password) {
    return { error: 'Navidrome password is required.' };
  }

  if (typeof record.syncEnabled !== 'boolean') {
    return { error: 'syncEnabled must be true or false.' };
  }

  return {
    value: {
      url: url.value.replace(/\/+$/, ''),
      username: username.value,
      password,
      syncEnabled: record.syncEnabled,
    },
  };
};

routes.get('/', (_req, res) => {
  res.status(200).json(redactSecrets(getSettings().navidrome));
});

routes.put(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const current = getSettings().navidrome;
    const parsed = parseNavidromeSettings(req.body, current);
    if ('error' in parsed) {
      return res.status(400).json({ message: parsed.error });
    }
    const saved = await getSettings().persistSection(
      'navidrome',
      () => parsed.value
    );
    return res.status(200).json(redactSecrets(saved));
  })
);

routes.post(
  '/test',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsed = parseNavidromeSettings(req.body, getSettings().navidrome);
    if ('error' in parsed) {
      return res.status(400).json({ message: parsed.error });
    }

    try {
      await new NavidromeAPI(parsed.value).ping();
      return res.status(204).end();
    } catch (error) {
      return res.status(502).json({
        message:
          error instanceof Error
            ? error.message
            : 'Could not connect to Navidrome.',
      });
    }
  })
);

routes.delete(
  '/',
  authorizedMutation(Permission.ADMIN, async (_req, res) => {
    // Albums marked available by the scanner are not bound to this service,
    // so disconnecting only stops future scans.
    await getSettings().persistSection('navidrome', () => null);
    return res.status(204).end();
  })
);

export default routes;
