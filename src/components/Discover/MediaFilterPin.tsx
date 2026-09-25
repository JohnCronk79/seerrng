import { getFilterToggleButtonClass } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import { PushPinIcon } from '@app/components/MediaDetails/DetailDisclosureButton';
import type useMediaFilterPin from '@app/hooks/useMediaFilterPin';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.MediaFilterPin', {
  pin: 'Pin media filter selection',
  unpin: 'Unpin media filter selection',
  failed: 'Could not save the media filter pin. Please try again.',
});

export default function MediaFilterPin({
  pin,
}: {
  pin: Omit<ReturnType<typeof useMediaFilterPin>, 'remember'>;
}) {
  const intl = useIntl();
  const label = intl.formatMessage(pin.pinned ? messages.unpin : messages.pin);
  return (
    <>
      <button
        type="button"
        className={getFilterToggleButtonClass(pin.pinned)}
        aria-label={label}
        title={label}
        aria-pressed={pin.pinned}
        disabled={!pin.available || pin.busy}
        onClick={pin.toggle}
      >
        <PushPinIcon
          filled={pin.pinned}
          className="h-3.5 w-3.5 rotate-45"
          aria-hidden="true"
        />
      </button>
      {pin.error && (
        <span role="alert">{intl.formatMessage(messages.failed)}</span>
      )}
    </>
  );
}
