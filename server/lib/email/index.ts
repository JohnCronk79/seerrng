import type { NotificationAgentEmail } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import Email from 'email-templates';
import net from 'node:net';
import type { SMTPTransportOptions } from 'nodemailer';
import nodemailer from 'nodemailer';
import { URL } from 'url';
import { openpgpEncrypt } from './openpgpEncrypt';

export const EMAIL_TRANSPORT_TIMEOUT_OPTIONS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

const getSocket: SMTPTransportOptions['getSocket'] = (options, callback) => {
  if (!options.host || typeof options.port !== 'number') {
    callback(new Error('SMTP host and port are required'), undefined);
    return;
  }

  const socket = net.connect({
    host: options.host,
    port: options.port,
  });
  const cleanup = () => {
    socket.setTimeout(0);
    socket.removeListener('error', onError);
    socket.removeListener('connect', onConnect);
    socket.removeListener('timeout', onTimeout);
  };
  const onError = (error: Error) => {
    cleanup();
    callback(error, undefined);
  };
  const onConnect = () => {
    cleanup();
    callback(null, { connection: socket });
  };
  const onTimeout = () => {
    cleanup();
    socket.destroy();
    callback(new Error('SMTP connection timed out'), undefined);
  };

  socket.once('error', onError);
  socket.once('connect', onConnect);
  socket.once('timeout', onTimeout);
  socket.setTimeout(10000);
};

class PreparedEmail extends Email {
  public constructor(settings: NotificationAgentEmail, pgpKey?: string) {
    const { applicationUrl } = getSettings().main;

    const transport = nodemailer.createTransport({
      name: applicationUrl ? new URL(applicationUrl).hostname : undefined,
      host: settings.options.smtpHost,
      port: settings.options.smtpPort,
      secure: settings.options.secure,
      ignoreTLS: settings.options.ignoreTls,
      requireTLS: settings.options.requireTls,
      tls: settings.options.allowSelfSigned
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
      ...EMAIL_TRANSPORT_TIMEOUT_OPTIONS,
      auth:
        settings.options.authUser && settings.options.authPass
          ? {
              user: settings.options.authUser,
              pass: settings.options.authPass,
            }
          : undefined,
      getSocket: net.isIP(settings.options.smtpHost) ? undefined : getSocket,
    });

    if (pgpKey) {
      transport.use(
        'stream',
        openpgpEncrypt({
          signingKey: settings.options.pgpPrivateKey,
          password: settings.options.pgpPassword,
          encryptionKeys: [pgpKey],
        })
      );
    }

    super({
      message: {
        from: {
          name: settings.options.senderName,
          address: settings.options.emailFrom,
        },
      },
      send: true,
      // email-templates still types its transport union against the older
      // @types/nodemailer Mail shape. Nodemailer 10 ships its own compatible
      // runtime/types, so keep this cast at the external type boundary.
      transport: transport as unknown as NonNullable<
        Email.EmailConfig['transport']
      >,
      preview: false,
    });
  }
}

export default PreparedEmail;
