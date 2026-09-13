import Spinner from '@app/assets/spinner.svg';
import Tooltip from '@app/components/Common/Tooltip';
import globalMessages from '@app/i18n/globalMessages';
import { CheckCircleIcon } from '@heroicons/react/20/solid';
import {
  BellIcon,
  ClockIcon,
  EyeSlashIcon,
  MinusSmallIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import { memo } from 'react';
import { useIntl } from 'react-intl';

export type StatusBadgeQuality = 'HD' | '4K' | 'MP3' | 'FLAC';

interface StatusBadgeMiniProps {
  status: MediaStatus;
  quality?: StatusBadgeQuality;
  inProgress?: boolean;
  // Should the badge shrink on mobile to a smaller size? (TitleCard)
  shrink?: boolean;
}

const StatusBadgeMini = memo(
  ({
    status,
    quality,
    inProgress = false,
    shrink = false,
  }: StatusBadgeMiniProps) => {
    const intl = useIntl();
    const badgeStyle = [
      `rounded-full shadow-md ${
        shrink ? 'h-6 w-6 border p-0' : 'w-5 ring-1 p-0.5'
      }`,
    ];

    let indicatorIcon: React.ReactNode;

    switch (status) {
      case MediaStatus.PROCESSING:
        badgeStyle.push(
          'bg-indigo-500/80 border-indigo-400 ring-indigo-400 text-indigo-100'
        );
        indicatorIcon = <ClockIcon />;
        break;
      case MediaStatus.AVAILABLE:
        badgeStyle.push(
          'bg-green-500/80 border-green-400 ring-green-400 text-green-100'
        );
        indicatorIcon = <CheckCircleIcon />;
        break;
      case MediaStatus.PENDING:
        badgeStyle.push(
          'bg-yellow-500/80 border-yellow-400 ring-yellow-400 text-yellow-100'
        );
        indicatorIcon = <BellIcon />;
        break;
      case MediaStatus.BLOCKLISTED:
        badgeStyle.push('bg-red-500/80 border-white ring-white text-white');
        indicatorIcon = <EyeSlashIcon />;
        break;
      case MediaStatus.PARTIALLY_AVAILABLE:
        badgeStyle.push(
          'bg-green-500/80 border-green-400 ring-green-400 text-green-100'
        );
        indicatorIcon = <MinusSmallIcon />;
        break;
      case MediaStatus.DELETED:
        badgeStyle.push(
          'bg-red-500/80 border-red-400 ring-red-400 text-red-100'
        );
        indicatorIcon = <TrashIcon />;
        break;
    }

    if (inProgress) {
      indicatorIcon = <Spinner />;
    }

    const statusLabel = (() => {
      if (inProgress) {
        return intl.formatMessage(globalMessages.processing);
      }

      switch (status) {
        case MediaStatus.PROCESSING:
          return intl.formatMessage(globalMessages.processing);
        case MediaStatus.AVAILABLE:
          return intl.formatMessage(globalMessages.available);
        case MediaStatus.PENDING:
          return intl.formatMessage(globalMessages.pending);
        case MediaStatus.BLOCKLISTED:
          return intl.formatMessage(globalMessages.blocklisted);
        case MediaStatus.PARTIALLY_AVAILABLE:
          return intl.formatMessage(globalMessages.partiallyavailable);
        case MediaStatus.DELETED:
          return intl.formatMessage(globalMessages.deleted);
        default:
          return undefined;
      }
    })();
    const label = [quality, statusLabel].filter(Boolean).join(' ');

    const badge = (
      <div
        className={`relative inline-flex whitespace-nowrap rounded-full border-gray-700 text-xs font-semibold leading-5 ring-gray-700 ${
          shrink ? '' : 'ring-1'
        }`}
        role="img"
        aria-label={label || undefined}
      >
        <div className={badgeStyle.join(' ')}>{indicatorIcon}</div>
        {quality && <span className="pl-1 pr-2 text-gray-200">{quality}</span>}
      </div>
    );

    return label ? <Tooltip content={label}>{badge}</Tooltip> : badge;
  }
);

StatusBadgeMini.displayName = 'StatusBadgeMini';

export default StatusBadgeMini;
