import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCertificationOptions } from './CertificationSelector';

describe('getCertificationOptions', () => {
  it('sorts a copy without mutating the shared provider response', () => {
    const certifications = [
      { certification: 'R', order: 2 },
      { certification: 'PG', meaning: 'Parental guidance', order: 1 },
    ];

    const options = getCertificationOptions(certifications);

    assert.deepStrictEqual(
      certifications.map(({ certification }) => certification),
      ['R', 'PG']
    );
    assert.deepStrictEqual(options, [
      {
        value: 'PG',
        label: 'PG - Parental guidance',
        certification: 'PG',
      },
      { value: 'R', label: 'R', certification: 'R' },
    ]);
  });
});
