import { CheckIcon } from '@heroicons/react/24/solid';

interface SelectionCircleProps {
  selected: boolean;
  partial?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

const SelectionCircle = ({
  selected,
  partial = false,
  disabled = false,
  label,
  onClick,
}: SelectionCircleProps) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    aria-label={label}
    aria-pressed={partial ? 'mixed' : selected}
    data-partial={partial || undefined}
    className="selection-circle"
  >
    <CheckIcon className="selection-circle-icon" aria-hidden="true" />
  </button>
);

export default SelectionCircle;
