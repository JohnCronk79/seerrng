import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import {
  ChevronDownIcon,
  MapPinIcon as PinIcon,
} from '@heroicons/react/24/outline';
import { MapPinIcon as PinnedIcon } from '@heroicons/react/24/solid';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaDetails.DetailDisclosure', {
  pin: 'Pin {label} open across detail pages',
  unpin: 'Unpin {label}',
});

interface DetailDisclosureButtonProps {
  label: string;
  open: boolean;
  onClick: () => void;
  pinned?: boolean;
  onPinClick?: () => void;
}

const DetailDisclosureButton = ({
  label,
  open,
  onClick,
  pinned = false,
  onPinClick,
}: DetailDisclosureButtonProps) => {
  const intl = useIntl();
  const pinLabel = intl.formatMessage(pinned ? messages.unpin : messages.pin, {
    label,
  });

  return (
    <span className="detail-disclosure-control">
      {onPinClick && (
        <Tooltip content={pinLabel}>
          <button
            type="button"
            className={`detail-disclosure-pin ${pinned ? 'detail-disclosure-pin-active' : ''}`}
            aria-label={pinLabel}
            aria-pressed={pinned}
            onClick={onPinClick}
          >
            {pinned ? (
              <PinnedIcon className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <PinIcon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      )}
      <button
        type="button"
        className="detail-disclosure-button"
        aria-expanded={open}
        onClick={onClick}
      >
        {label}
        <ChevronDownIcon
          className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
    </span>
  );
};

export default DetailDisclosureButton;
