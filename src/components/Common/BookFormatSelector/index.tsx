import BookFormatBadge, {
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import { getFilterToggleButtonClass } from '@app/components/Discover/FilterPanel/CompactFilterSelect';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.BookFormatSelector', {
  format: 'Format',
});

type SelectableBookFormat = Exclude<RequestedBookFormat, 'both'>;

interface BookFormatSelectorProps {
  value: SelectableBookFormat;
  available: Record<SelectableBookFormat, boolean>;
  onChange: (value: SelectableBookFormat) => void;
  className?: string;
}

const BookFormatSelector = ({
  value,
  available,
  onChange,
  className = 'mt-0',
}: BookFormatSelectorProps) => {
  const intl = useIntl();
  const options: SelectableBookFormat[] = ['ebook', 'audiobook'];

  return (
    <fieldset className={className}>
      <legend className="text-label">
        {intl.formatMessage(messages.format)}
      </legend>
      <div
        className="mt-2 flex flex-wrap items-center gap-2"
        role="radiogroup"
        aria-label={intl.formatMessage(messages.format)}
      >
        {options.map((option) => {
          const isSelected = value === option;
          const isAvailable = available[option];

          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!isAvailable}
              onClick={() => onChange(option)}
              className={`${getFilterToggleButtonClass(isSelected)} min-w-0 disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <BookFormatBadge
                format={option}
                variant="selector"
                className="gap-1.5 text-xs text-inherit"
              />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};

export default BookFormatSelector;
