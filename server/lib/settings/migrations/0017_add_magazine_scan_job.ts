import type { AllSettings } from '@server/lib/settings';

const addMagazineScanJob = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0017_add_magazine_scan_job')
  ) {
    return settings;
  }

  settings.jobs ??= {};
  settings.jobs['magazine-scan'] ??= { schedule: '0 30 5 * * *' };
  settings.lazylibrarian ??= [];
  settings.migrations ??= [];
  settings.migrations.push('0017_add_magazine_scan_job');
  return settings;
};

export default addMagazineScanJob;
