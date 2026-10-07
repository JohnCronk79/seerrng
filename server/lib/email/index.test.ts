import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { join } from 'node:path';

import { getSettings } from '@server/lib/settings';
import PreparedEmail, { EMAIL_TRANSPORT_TIMEOUT_OPTIONS } from '.';

describe('EMAIL_TRANSPORT_TIMEOUT_OPTIONS', () => {
  it('bounds SMTP connection lifetimes', () => {
    assert.equal(EMAIL_TRANSPORT_TIMEOUT_OPTIONS.connectionTimeout, 10_000);
    assert.equal(EMAIL_TRANSPORT_TIMEOUT_OPTIONS.greetingTimeout, 10_000);
    assert.equal(EMAIL_TRANSPORT_TIMEOUT_OPTIONS.socketTimeout, 30_000);
  });
});

describe('password setup email rendering', () => {
  it('renders safely when the recipient name has not been initialized', async () => {
    const settings = getSettings();
    settings.main.applicationUrl = 'https://seerr.example';
    const email = new PreparedEmail(settings.notifications.agents.email);

    await assert.doesNotReject(
      email.render(
        join(__dirname, '../../templates/email/resetpassword/html'),
        {
          applicationTitle: 'SeerrNG',
          applicationUrl: settings.main.applicationUrl,
          resetPasswordLink: 'https://seerr.example/resetpassword/example',
          recipientEmail: 'new-user@example.com',
          recipientName: undefined,
        }
      )
    );
  });
});
