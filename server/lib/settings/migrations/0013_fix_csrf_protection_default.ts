import type { AllSettings } from '@server/lib/settings';

type MutableSettings = {
  network?: { csrfProtection?: boolean };
  migrations?: string[];
};

// CSRF protection was accidentally defaulted to enabled from the fork's
// earliest settings, contradicting the documented "disabled by default"
// behavior and breaking Jellyfin/Emby sign-in for anyone who never touched
// this advanced setting. Force it off exactly once so existing installs
// match the corrected default. This cannot distinguish a deliberate opt-in
// from the buggy default, so anyone who intentionally enabled CSRF
// protection before this migration ships will need to re-enable it; any
// opt-in after this migration has already run is left alone.
const fixCsrfProtectionDefault = (settings: AllSettings): AllSettings => {
  const mutableSettings = settings as unknown as MutableSettings;

  if (
    Array.isArray(mutableSettings.migrations) &&
    mutableSettings.migrations.includes('0013_fix_csrf_protection_default')
  ) {
    return settings;
  }

  if (!mutableSettings.network) {
    mutableSettings.network = {};
  }

  mutableSettings.network.csrfProtection = false;

  if (!Array.isArray(mutableSettings.migrations)) {
    mutableSettings.migrations = [];
  }
  mutableSettings.migrations.push('0013_fix_csrf_protection_default');

  return settings;
};

export default fixCsrfProtectionDefault;
