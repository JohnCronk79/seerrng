import type { TlsStatusResponse } from '@server/interfaces/api/settingsInterfaces';

type BrowserTransportStatus = Pick<
  TlsStatusResponse,
  'mode' | 'httpAuthAllowed' | 'pendingRestart'
>;

/**
 * A browser can sign in only when the current request is HTTPS or the
 * explicitly acknowledged direct-HTTP fallback is active. A saved transport
 * choice is not enough because listener and cookie changes require a restart.
 */
export const isBrowserTransportReady = (
  status: BrowserTransportStatus,
  browserUsesHttps: boolean
): boolean => {
  if (browserUsesHttps) {
    return true;
  }

  return (
    !status.pendingRestart &&
    status.mode === 'disabled' &&
    status.httpAuthAllowed
  );
};
