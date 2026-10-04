import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import {
  MAX_PGP_MESSAGE_BYTES,
  PGPEncryptor,
  openpgpEncrypt,
} from './openpgpEncrypt';

describe('openpgpEncrypt', () => {
  it('does not install a transform or invoke the callback twice without keys', async () => {
    let callbackCount = 0;
    let transformCount = 0;
    const plugin = openpgpEncrypt({ encryptionKeys: [] });

    await new Promise<void>((resolve, reject) => {
      plugin(
        {
          message: {
            transform: () => {
              transformCount += 1;
            },
          },
        } as unknown as Parameters<typeof plugin>[0],
        (error) => {
          callbackCount += 1;
          if (error) {
            reject(error);
          } else {
            setImmediate(resolve);
          }
        }
      );
    });

    assert.equal(callbackCount, 1);
    assert.equal(transformCount, 0);
  });
});

describe('PGPEncryptor', () => {
  it('fails closed instead of emitting plaintext when encryption fails', async () => {
    const encryptor = new PGPEncryptor({
      encryptionKeys: ['not an armored OpenPGP key'],
    });
    const output: Buffer[] = [];
    encryptor.on('data', (chunk: Buffer) => output.push(chunk));

    const errorPromise = once(encryptor, 'error');
    encryptor.end(Buffer.from('Subject: secret\r\n\r\nplaintext body'));
    const [error] = await errorPromise;

    assert.ok(error instanceof Error);
    assert.equal(output.length, 0);
  });

  it('rejects messages beyond the bounded encryption buffer', async () => {
    const encryptor = new PGPEncryptor({ encryptionKeys: ['unused'] });
    const errorPromise = once(encryptor, 'error');
    encryptor.end(Buffer.alloc(MAX_PGP_MESSAGE_BYTES + 1));
    const [error] = await errorPromise;

    assert.match(String(error), /exceeds the size limit/u);
  });
});
