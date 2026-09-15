import { CompactSelect } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.MediaDetails.MediaQualitySelect', {
  selectQuality: 'Select Quality',
});

interface MediaQualitySelectProps<Quality extends string> {
  value: Quality;
  options: { label: string; value: Quality }[];
  onChange: (quality: Quality) => void;
  className?: string;
}

const MediaQualitySelect = <Quality extends string>({
  value,
  options,
  onChange,
  className = '',
}: MediaQualitySelectProps<Quality>) => {
  const intl = useIntl();

  return (
    <CompactSelect
      label={intl.formatMessage(messages.selectQuality)}
      value={value}
      options={options}
      onChange={(quality) => onChange(quality as Quality)}
      defaultValue={options[0]?.value}
      className={className}
    />
  );
};

export default MediaQualitySelect;
