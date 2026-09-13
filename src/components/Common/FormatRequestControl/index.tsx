import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Common.FormatRequestControl', {
  request: 'Request',
});

export interface FormatRequestOption {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

interface FormatRequestControlProps {
  options: FormatRequestOption[];
  className?: string;
}

const FormatRequestControl = ({
  options,
  className,
}: FormatRequestControlProps) => {
  const intl = useIntl();

  if (options.length === 0) {
    return null;
  }

  return (
    <div
      className={`format-request-control ${className ?? ''}`}
      data-testid="format-request-control"
    >
      <span className="format-request-label">
        <ArrowDownTrayIcon className="h-4 w-4" />
        {intl.formatMessage(messages.request)}
      </span>
      {options.map((option) => {
        const button = (
          <button
            key={option.id}
            type="button"
            data-testid={`format-request-option-${option.id}`}
            disabled={option.disabled}
            title={option.disabled ? option.disabledReason : undefined}
            onClick={option.onClick}
            className="format-request-option"
          >
            {option.label}
          </button>
        );

        return option.disabled && option.disabledReason ? (
          <Tooltip key={option.id} content={option.disabledReason}>
            <span className="inline-flex">{button}</span>
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
};

export default FormatRequestControl;
