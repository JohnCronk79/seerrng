import type { AllSettings } from '@server/lib/settings';

const migrateTransportSecuritySettings = (settings: any): AllSettings => {
  if (settings.network?.tls) {
    return settings;
  }

  settings.network = {
    ...settings.network,
    tls: {
      mode: 'disabled',
      httpsPort: 5056,
      hosts: 'localhost,127.0.0.1,::1',
      certificateFile: '',
      keyFile: '',
      caFile: '',
      redirectHttpToHttps: false,
      allowHttpAuth: false,
      httpAuthAcknowledged: false,
    },
  };

  return settings;
};

export default migrateTransportSecuritySettings;
