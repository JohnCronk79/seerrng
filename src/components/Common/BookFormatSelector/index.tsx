import BookFormatBadge, {
  type RequestedBookFormat,
} from '@app/components/Common/BookFormatBadge';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.BookFormatSelector', {
  format: 'Format',
});

interface BookFormatSelectorProps {
  value: RequestedBookFormat;
  available: Record<RequestedBookFormat, boolean>;
  onChange: (value: RequestedBookFormat) => void;
  className?: string;
}

const BookFormatSelector = ({
  value,
  available,
  onChange,
  className = 'mt-0',
}: BookFormatSelectorProps) => {
  const intl = useIntl();
  const options: RequestedBookFormat[] = ['ebook', 'audiobook', 'both'];

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
              className={`inline-flex h-8 min-w-0 items-center justify-center whitespace-nowrap rounded-md border px-[9px] text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-45 ${
                isSelected
                  ? 'border-indigo-400 bg-indigo-500 text-white'
                  : 'border-gray-600 bg-gray-900/70 text-gray-300 hover:border-gray-400 hover:text-white'
              }`}
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
