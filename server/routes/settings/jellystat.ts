import JellystatAPI from '@server/api/jellystat';
import { Permission } from '@server/lib/permissions';
import type { JellystatSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import {
  REDACTED_SECRET,
  isValidHttpUrl,
  redactSecrets,
} from '@server/utils/security';
import { parseBoundedString } from '@server/utils/validation';
import { Router } from 'express';

const routes = Router();

/** Validates a request body. A redacted API key keeps the saved key. */
export const parseJellystatSettings = (
  body: unknown,
  current?: JellystatSettings | null
): { value: JellystatSettings } | { error: string } => {
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
    return { error: 'Jellystat URL must be a valid HTTP or HTTPS address.' };
  }

  const keyInput = parseBoundedString(record.apiKey, {
    fieldName: 'apiKey',
    maxLength: 512,
  });
  if ('error' in keyInput) return keyInput;
  const apiKey =
    keyInput.value === REDACTED_SECRET
      ? (current?.apiKey ?? '')
      : keyInput.value;
  if (!apiKey) {
    return { error: 'Jellystat API key is required.' };
  }

  return { value: { url: url.value.replace(/\/+$/, ''), apiKey } };
};

routes.get('/', (_req, res) => {
  res.status(200).json(redactSecrets(getSettings().jellystat));
});

routes.put(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsed = parseJellystatSettings(req.body, getSettings().jellystat);
    if ('error' in parsed) {
      return res.status(400).json({ message: parsed.error });
    }
    const saved = await getSettings().persistSection(
      'jellystat',
      () => parsed.value
    );
    return res.status(200).json(redactSecrets(saved));
  })
);

routes.post(
  '/test',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const parsed = parseJellystatSettings(req.body, getSettings().jellystat);
    if ('error' in parsed) {
      return res.status(400).json({ message: parsed.error });
    }

    try {
      await new JellystatAPI(parsed.value).ping();
      return res.status(204).end();
    } catch (error) {
      return res.status(502).json({
        message:
          error instanceof Error
            ? error.message
            : 'Could not connect to Jellystat.',
      });
    }
  })
);

routes.delete(
  '/',
  authorizedMutation(Permission.ADMIN, async (_req, res) => {
    await getSettings().persistSection('jellystat', () => null);
    return res.status(204).end();
  })
);

export default routes;
