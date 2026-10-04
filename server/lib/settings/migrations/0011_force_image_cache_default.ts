import type { AllSettings } from '@server/lib/settings';

const forceImageCacheDefault = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0011_force_image_cache_default')
  ) {
    return settings;
  }

  if (!settings.main) {
    settings.main = {};
  }

  settings.main.cacheImages = true;

  if (!Array.isArray(settings.migrations)) {
    settings.migrations = [];
  }
  settings.migrations.push('0011_force_image_cache_default');

  return settings;
};

export default forceImageCacheDefault;
