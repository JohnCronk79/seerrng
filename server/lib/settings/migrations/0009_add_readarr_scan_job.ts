import type { AllSettings } from '@server/lib/settings';

const addReadarrScanJob = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0009_add_readarr_scan_job')
  ) {
    return settings;
  }

  if (!settings.jobs) {
    settings.jobs = {};
  }

  if (!settings.jobs['readarr-scan']) {
    settings.jobs['readarr-scan'] = {
      schedule: '0 45 4 * * *',
    };
  }

  if (!Array.isArray(settings.migrations)) {
    settings.migrations = [];
  }
  settings.migrations.push('0009_add_readarr_scan_job');

  return settings;
};

export default addReadarrScanJob;
