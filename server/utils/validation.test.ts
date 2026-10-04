import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseBoundedString,
  parseOptionalAllowedString,
  parseOptionalBodyBoolean,
  parseOptionalBoolean,
  parseOptionalBoundedString,
  parseOptionalLanguage,
  parseOptionalNonNegativeInteger,
  parseOptionalQueryBoolean,
} from './validation';

describe('parseBoundedString', () => {
  it('trims and returns bounded strings', () => {
    assert.deepEqual(
      parseBoundedString('  hello  ', {
        fieldName: 'Message',
        maxLength: 10,
      }),
      { value: 'hello' }
    );
  });

  it('rejects missing, blank, and oversized values', () => {
    assert.deepEqual(
      parseBoundedString(undefined, {
        fieldName: 'Message',
        maxLength: 10,
      }),
      { error: 'Message must be a string.' }
    );
    assert.deepEqual(
      parseBoundedString('   ', {
        fieldName: 'Message',
        maxLength: 10,
      }),
      { error: 'Message is required.' }
    );
    assert.deepEqual(
      parseBoundedString('x'.repeat(11), {
        fieldName: 'Message',
        maxLength: 10,
      }),
      { error: 'Message must be 10 characters or fewer.' }
    );
  });
});

describe('parseOptionalBoundedString', () => {
  it('accepts absent values and trims present values', () => {
    assert.deepEqual(
      parseOptionalBoundedString(undefined, {
        fieldName: 'Token',
        maxLength: 10,
      }),
      { value: undefined }
    );
    assert.deepEqual(
      parseOptionalBoundedString('  token  ', {
        fieldName: 'Token',
        maxLength: 10,
      }),
      { value: 'token' }
    );
  });

  it('rejects non-string and oversized values', () => {
    assert.deepEqual(
      parseOptionalBoundedString(123, {
        fieldName: 'Token',
        maxLength: 10,
      }),
      { error: 'Token must be a string.' }
    );
    assert.deepEqual(
      parseOptionalBoundedString('x'.repeat(11), {
        fieldName: 'Token',
        maxLength: 10,
      }),
      { error: 'Token must be 10 characters or fewer.' }
    );
  });
});

describe('parseOptionalLanguage', () => {
  it('accepts absent language values and rejects arrays or oversized values', () => {
    assert.deepEqual(parseOptionalLanguage(undefined), { value: undefined });
    assert.deepEqual(parseOptionalLanguage(' en-US '), { value: 'en-US' });
    assert.deepEqual(parseOptionalLanguage(['en', 'fr']), {
      error: 'Language must be a string.',
    });
    assert.deepEqual(parseOptionalLanguage('x'.repeat(33)), {
      error: 'Language must be 32 characters or fewer.',
    });
  });
});

describe('parseOptionalAllowedString', () => {
  it('accepts allowed values and rejects arrays, oversized values, or unknown values', () => {
    assert.deepEqual(
      parseOptionalAllowedString('modified', {
        fieldName: 'Sort',
        allowedValues: ['created', 'modified'] as const,
        maxLength: 16,
      }),
      { value: 'modified' }
    );
    assert.deepEqual(
      parseOptionalAllowedString(['modified'], {
        fieldName: 'Sort',
        allowedValues: ['created', 'modified'] as const,
        maxLength: 16,
      }),
      { error: 'Sort must be a string.' }
    );
    assert.deepEqual(
      parseOptionalAllowedString('x'.repeat(17), {
        fieldName: 'Sort',
        allowedValues: ['created', 'modified'] as const,
        maxLength: 16,
      }),
      { error: 'Sort must be 16 characters or fewer.' }
    );
    assert.deepEqual(
      parseOptionalAllowedString('other', {
        fieldName: 'Sort',
        allowedValues: ['created', 'modified'] as const,
        maxLength: 16,
      }),
      { error: 'Sort must be valid.' }
    );
  });
});

describe('parseOptionalQueryBoolean', () => {
  it('accepts true or false query strings and rejects other values', () => {
    assert.deepEqual(parseOptionalQueryBoolean(undefined, 'Sync'), {
      value: undefined,
    });
    assert.deepEqual(parseOptionalQueryBoolean('true', 'Sync'), {
      value: true,
    });
    assert.deepEqual(parseOptionalQueryBoolean('false', 'Sync'), {
      value: false,
    });
    assert.deepEqual(parseOptionalQueryBoolean(true, 'Sync'), {
      value: true,
    });
    assert.deepEqual(parseOptionalQueryBoolean(false, 'Sync'), {
      value: false,
    });
    assert.deepEqual(parseOptionalQueryBoolean(['true'], 'Sync'), {
      error: 'Sync must be a string.',
    });
    assert.deepEqual(parseOptionalQueryBoolean('yes', 'Sync'), {
      error: 'Sync must be valid.',
    });
  });
});

describe('parseOptionalBodyBoolean', () => {
  it('accepts boolean body values and rejects string booleans', () => {
    assert.deepEqual(parseOptionalBodyBoolean(undefined, 'Start'), {
      value: undefined,
    });
    assert.deepEqual(parseOptionalBodyBoolean(true, 'Start'), {
      value: true,
    });
    assert.deepEqual(parseOptionalBodyBoolean(false, 'Start'), {
      value: false,
    });
    assert.deepEqual(parseOptionalBodyBoolean('true', 'Start'), {
      error: 'Start must be a boolean.',
    });
  });
});

describe('parseOptionalBoolean', () => {
  it('only accepts booleans', () => {
    assert.equal(parseOptionalBoolean(true), true);
    assert.equal(parseOptionalBoolean(false), false);
    assert.equal(parseOptionalBoolean('true'), undefined);
  });
});

describe('parseOptionalNonNegativeInteger', () => {
  it('only accepts integers inside range', () => {
    assert.equal(parseOptionalNonNegativeInteger(5, 10), 5);
    assert.equal(parseOptionalNonNegativeInteger(-1, 10), undefined);
    assert.equal(parseOptionalNonNegativeInteger(11, 10), undefined);
    assert.equal(parseOptionalNonNegativeInteger(1.5, 10), undefined);
  });
});
