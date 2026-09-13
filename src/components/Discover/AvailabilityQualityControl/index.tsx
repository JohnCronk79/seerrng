import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

export type AvailabilityQuality = 'hd' | '4k' | 'mp3' | 'flac';

interface AvailabilityQualityControlProps {
  mediaType: 'movie' | 'tv' | 'music';
  value?: AvailabilityQuality;
  onChange: (value?: AvailabilityQuality) => void;
  className?: string;
}

const messages = defineMessages(
  'components.Discover.AvailabilityQualityControl',
  {
    label: 'Quality Available',
    all: 'All',
  }
);

const AvailabilityQualityControl = ({
  mediaType,
  value,
  onChange,
  className,
}: AvailabilityQualityControlProps) => {
  const intl = useIntl();
  const options: { label: string; value?: AvailabilityQuality }[] =
    mediaType === 'music'
      ? [
          { label: intl.formatMessage(messages.all) },
          { label: 'MP3', value: 'mp3' },
          { label: 'FLAC', value: 'flac' },
        ]
      : [
          { label: intl.formatMessage(messages.all) },
          { label: 'HD', value: 'hd' },
          { label: '4K', value: '4k' },
        ];

  return (
    <div
      className={`availability-quality-control ${className ?? ''}`}
      role="group"
      aria-label={intl.formatMessage(messages.label)}
    >
      <span className="availability-quality-label">
        {intl.formatMessage(messages.label)}
      </span>
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value ?? 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`availability-quality-option ${
              active ? 'availability-quality-option-active' : ''
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default AvailabilityQualityControl;
