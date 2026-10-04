import type { AllSettings } from '@server/lib/settings';

const enableImageCache = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0010_enable_image_cache')
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
  settings.migrations.push('0010_enable_image_cache');

  return settings;
};

export default enableImageCache;
