import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaStatus } from '@server/constants/media';
import { getMediaAvailabilityTone } from './AvailabilityValue';

describe('getMediaAvailabilityTone', () => {
  it('uses green for complete and partial availability', () => {
    assert.equal(getMediaAvailabilityTone(MediaStatus.AVAILABLE), 'available');
    assert.equal(
      getMediaAvailabilityTone(MediaStatus.PARTIALLY_AVAILABLE),
      'available'
    );
  });

  it('uses yellow for processing and pending availability', () => {
    assert.equal(
      getMediaAvailabilityTone(MediaStatus.PROCESSING),
      'processing'
    );
    assert.equal(getMediaAvailabilityTone(MediaStatus.PENDING), 'processing');
  });

  it('uses red when the media is unavailable or blocked', () => {
    assert.equal(getMediaAvailabilityTone(undefined), 'unavailable');
    assert.equal(getMediaAvailabilityTone(MediaStatus.UNKNOWN), 'unavailable');
    assert.equal(
      getMediaAvailabilityTone(MediaStatus.BLOCKLISTED),
      'unavailable'
    );
  });
});
