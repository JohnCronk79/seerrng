import type { AllSettings } from '@server/lib/settings';

type MutableSettings = {
  network?: {
    tls?: {
      mode?: string;
      allowHttpAuth?: boolean;
      httpAuthAcknowledged?: boolean;
    };
  };
  migrations?: string[];
};

const MIGRATION_NAME = '0015_enable_default_http_auth';

// The transport feature initially shipped with HTTP authentication disabled,
// even though the default listener is plain HTTP. That left every untouched
// installation unable to persist a browser login. Normalize that old default
// once; administrators can still turn it off afterward or set the environment
// override to require HTTPS.
const enableDefaultHttpAuth = (settings: AllSettings): AllSettings => {
  const mutableSettings = settings as unknown as MutableSettings;

  if (
    Array.isArray(mutableSettings.migrations) &&
    mutableSettings.migrations.includes(MIGRATION_NAME)
  ) {
    return settings;
  }

  const tls = mutableSettings.network?.tls;
  if (tls?.mode === 'disabled' && tls.allowHttpAuth !== true) {
    tls.allowHttpAuth = true;
    tls.httpAuthAcknowledged = true;
  }

  if (!Array.isArray(mutableSettings.migrations)) {
    mutableSettings.migrations = [];
  }
  mutableSettings.migrations.push(MIGRATION_NAME);

  return settings;
};

export default enableDefaultHttpAuth;
