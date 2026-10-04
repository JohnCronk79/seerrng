import LazyLibrarianAPI from '@server/api/lazylibrarian';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { Permission } from '@server/lib/permissions';
import { runWithServarrServiceCollectionMutationAdmission } from '@server/lib/serviceAdmission';
import {
  allocateServarrServiceId,
  assertServarrServiceCanBeRemoved,
  getHistoricalServarrServiceIdMaximum,
} from '@server/lib/serviceId';
import type { LazyLibrarianSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { authorizedMutation } from '@server/middleware/authorizedMutation';
import { parseNonNegativeRouteId } from '@server/utils/routeId';
import { REDACTED_SECRET, redactSecrets } from '@server/utils/security';
import {
  assertServarrInstanceCapacity,
  parseLazyLibrarianSettings,
  parseServarrConnectionSettings,
  preserveServarrConnectionSecret,
  type ServarrConnectionSettings,
} from '@server/utils/servarrSettings';
import { Router } from 'express';

const lazyLibrarianRoutes = Router();

lazyLibrarianRoutes.get('/', (_req, res) => {
  res.status(200).json(redactSecrets(getSettings().lazylibrarian));
});

lazyLibrarianRoutes.post(
  '/',
  authorizedMutation(Permission.ADMIN, async (req, res) => {
    const settings = getSettings();
    const parsed = parseLazyLibrarianSettings(req.body);
    if ('error' in parsed) {
      return res.status(400).json({ message: parsed.error });
    }

    return runWithServarrServiceCollectionMutationAdmission(
      'lazylibrarian',
      async () => {
        const historicalMaximum =
          await getHistoricalServarrServiceIdMaximum('lazylibrarian');
        const services = await settings.persistSection(
          'lazylibrarian',
          (current) => {
            assertServarrInstanceCapacity(current);
            const created: LazyLibrarianSettings = {
              ...parsed.value,
              id: allocateServarrServiceId(
                current.map(({ id }) => id),
                historicalMaximum
              ),
            };
            return [
              ...current.map((service) =>
                created.isDefault ? { ...service, isDefault: false } : service
              ),
              created,
            ];
          }
        );
        const created = services[services.length - 1];
        return res.status(201).json(redactSecrets(created));
      }
    );
  })
);

lazyLibrarianRoutes.post<
  undefined,
  Record<string, unknown>,
  ServarrConnectionSettings
>(
  '/test',
  authorizedMutation<
    undefined,
    Record<string, unknown>,
    ServarrConnectionSettings
  >(Permission.ADMIN, async (req, res, next) => {
    try {
      const parsed = parseServarrConnectionSettings(
        preserveServarrConnectionSecret(
          req.body,
          getExternalRuntimeConfig().lazylibrarian
        )
      );
      if ('error' in parsed) {
        return res.status(400).json({ message: parsed.error });
      }
      const api = new LazyLibrarianAPI({
        url: LazyLibrarianAPI.buildUrl(parsed.value),
        apiKey: parsed.value.apiKey,
      });
      return res.status(200).json({ version: await api.getVersion() });
    } catch (error) {
      logger.error('Failed to test LazyLibrarian', {
        label: 'LazyLibrarian',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return next({
        status: 500,
        message: 'Failed to connect to LazyLibrarian.',
      });
    }
  })
);

lazyLibrarianRoutes.put<{ id: string }, LazyLibrarianSettings>(
  '/:id',
  authorizedMutation<{ id: string }, LazyLibrarianSettings>(
    Permission.ADMIN,
    async (req, res, next) => {
      const serviceId = parseNonNegativeRouteId(req.params.id);
      const settings = getSettings();
      const current = settings.lazylibrarian.find(({ id }) => id === serviceId);
      if (!current) {
        return next({ status: 404, message: 'Settings instance not found.' });
      }

      const parsed = parseLazyLibrarianSettings(req.body, current);
      if ('error' in parsed) {
        return next({ status: 400, message: parsed.error });
      }

      return runWithServarrServiceCollectionMutationAdmission(
        'lazylibrarian',
        async () => {
          const updated = await settings.persistSection(
            'lazylibrarian',
            (services) =>
              services.map((service) =>
                service.id === serviceId
                  ? {
                      ...parsed.value,
                      id: serviceId,
                      apiKey:
                        (req.body as { apiKey?: unknown }).apiKey ===
                        REDACTED_SECRET
                          ? service.apiKey
                          : parsed.value.apiKey,
                    }
                  : parsed.value.isDefault
                    ? { ...service, isDefault: false }
                    : service
              )
          );
          return res
            .status(200)
            .json(redactSecrets(updated.find(({ id }) => id === serviceId)));
        }
      );
    }
  )
);

lazyLibrarianRoutes.delete<{ id: string }>(
  '/:id',
  authorizedMutation<{ id: string }>(
    Permission.ADMIN,
    async (req, res, next) => {
      const serviceId = parseNonNegativeRouteId(req.params.id);
      if (serviceId === undefined) {
        return next({ status: 404, message: 'Settings instance not found.' });
      }
      const settings = getSettings();
      const removed = settings.lazylibrarian.find(({ id }) => id === serviceId);
      if (!removed) {
        return next({ status: 404, message: 'Settings instance not found.' });
      }

      return runWithServarrServiceCollectionMutationAdmission(
        'lazylibrarian',
        async () => {
          await assertServarrServiceCanBeRemoved('lazylibrarian', serviceId);
          await settings.persistSection('lazylibrarian', (services) =>
            services.filter(({ id }) => id !== serviceId)
          );
          return res.status(200).json(redactSecrets(removed));
        }
      );
    }
  )
);

export default lazyLibrarianRoutes;
