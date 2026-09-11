import { ChevronDownIcon } from '@heroicons/react/24/outline';

interface DetailDisclosureButtonProps {
  label: string;
  open: boolean;
  onClick: () => void;
}

const DetailDisclosureButton = ({
  label,
  open,
  onClick,
}: DetailDisclosureButtonProps) => (
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
);

export default DetailDisclosureButton;
