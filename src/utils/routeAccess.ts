export const isPathPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export const isSetupPath = (pathname: string): boolean =>
  isPathPrefix(pathname, '/setup');

export const isLoginPath = (pathname: string): boolean =>
  isPathPrefix(pathname, '/login');

export const isPlexLoginCompletionPath = (
  pathname: string,
  completionMarker: string | null
): boolean =>
  pathname === '/login/plex/loading' && completionMarker === '1';

export const isResetPasswordPath = (pathname: string): boolean =>
  isPathPrefix(pathname, '/resetpassword');

export const isPublicAuthPath = (pathname: string): boolean =>
  isSetupPath(pathname) ||
  isLoginPath(pathname) ||
  isResetPasswordPath(pathname);
