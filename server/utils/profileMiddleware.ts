import { Permission } from '@server/lib/permissions';
import { parsePositiveRouteId } from './routeId';

const parseProfileId = (id: unknown): number | undefined =>
  parsePositiveRouteId(id, 1_000_000_000);

export const isOwnProfile = (): Middleware => {
  return (req, res, next) => {
    const profileId = parseProfileId(req.params.id);
    if (!profileId || req.user?.id !== profileId) {
      return next({
        status: 403,
        message: "You do not have permission to view this user's settings.",
      });
    }
    next();
  };
};

export const isOwnProfileOrAdmin = (): Middleware => {
  const authMiddleware: Middleware = (req, res, next) => {
    const profileId = parseProfileId(req.params.id);
    if (
      !req.user?.hasPermission(Permission.MANAGE_USERS) &&
      (!profileId || req.user?.id !== profileId)
    ) {
      return next({
        status: 403,
        message: "You do not have permission to view this user's settings.",
      });
    }

    next();
  };
  return authMiddleware;
};
