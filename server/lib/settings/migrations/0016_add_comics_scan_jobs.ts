import type { AllSettings } from '@server/lib/settings';

const addComicsScanJobs = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0016_add_comics_scan_jobs')
  ) {
    return settings;
  }

  if (!settings.jobs) {
    settings.jobs = {};
  }

  if (!settings.jobs['mylar-scan']) {
    settings.jobs['mylar-scan'] = {
      schedule: '0 0 5 * * *',
    };
  }

  if (!settings.jobs['kapowarr-scan']) {
    settings.jobs['kapowarr-scan'] = {
      schedule: '0 15 5 * * *',
    };
  }

  if (!Array.isArray(settings.migrations)) {
    settings.migrations = [];
  }
  settings.migrations.push('0016_add_comics_scan_jobs');

  return settings;
};

export default addComicsScanJobs;
