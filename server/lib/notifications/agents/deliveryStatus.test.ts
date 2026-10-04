import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import PreparedEmail from '@server/lib/email';
import { Notification } from '@server/lib/notifications';
import { setupTestDb } from '@server/test/db';
import EmailAgent from './email';

setupTestDb();

afterEach(() => {
  mock.restoreAll();
});

describe('notification agent delivery status', () => {
  it('reports an administrator email failure to the outbox', async () => {
    mock.method(PreparedEmail.prototype, 'send', async () => {
      throw new Error('SMTP unavailable');
    });
    const agent = new EmailAgent({
      enabled: true,
      embedPoster: false,
      types: Notification.MEDIA_PENDING,
      options: {
        userEmailRequired: false,
        usePublicLogo: false,
        emailFrom: 'seerr@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        secure: false,
        ignoreTls: false,
        requireTls: false,
        allowSelfSigned: false,
        senderName: 'Seerr',
      },
    });

    const delivered = await agent.send(Notification.MEDIA_PENDING, {
      subject: 'New request',
      notifySystem: false,
      notifyAdmin: true,
    });

    assert.strictEqual(delivered, false);
  });
});
