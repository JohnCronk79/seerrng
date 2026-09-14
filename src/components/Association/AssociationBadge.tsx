import MeshNetworkIcon from '@app/assets/mesh-network.svg';
import Button from '@app/components/Common/Button';
import Tooltip from '@app/components/Common/Tooltip';
import type { AssociationMediaType } from '@app/hooks/useAssociations';
import useAssociations, {
  toAssociationMediaType,
} from '@app/hooks/useAssociations';
import defineMessages from '@app/utils/defineMessages';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';
import AssociationPopover from './AssociationPopover';

const messages = defineMessages('components.Association', {
  associations: 'Associations',
});

interface AssociationBadgeProps {
  mediaType: string;
  id: string | number;
  /** 'card' floats over poster art; 'inline' sits next to a title. */
  variant?: 'card' | 'inline' | 'button';
  hideWhenEmpty?: boolean;
}

const AssociationBadge = ({
  mediaType,
  id,
  variant = 'card',
  hideWhenEmpty = false,
}: AssociationBadgeProps) => {
  const intl = useIntl();
  const [isOpen, setIsOpen] = useState(false);
  const associationType: AssociationMediaType | null =
    toAssociationMediaType(mediaType);
  const { isLoading: isChecking, hasStrongEdges } = useAssociations(
    associationType,
    id,
    {
      enabled: hideWhenEmpty && !!associationType,
      includeWeak: false,
    }
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen]);

  if (!associationType || id == null || id === '') {
    return null;
  }

  if (hideWhenEmpty && (isChecking || !hasStrongEdges)) {
    return null;
  }

  const associationLabel = intl.formatMessage(messages.associations);
  const buttonClass =
    variant === 'card'
      ? 'app-button app-button-association h-6 w-6 rounded-full p-0 shadow-md shadow-cyan-950/40 backdrop-blur'
      : 'flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-gray-300 ring-1 ring-gray-700 transition hover:text-white';

  const toggleAssociations = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (hideWhenEmpty && isChecking) {
      return;
    }
    setIsOpen((open) => !open);
  };

  return (
    <>
      <Tooltip content={associationLabel}>
        {variant === 'button' ? (
          <Button
            buttonType="association"
            buttonSize="sm"
            data-testid="association-badge"
            aria-label={associationLabel}
            disabled={hideWhenEmpty && isChecking}
            onClick={toggleAssociations}
          >
            <MeshNetworkIcon className="h-4 w-4" aria-hidden="true" />
            <span className="ml-1.5">{associationLabel}</span>
          </Button>
        ) : (
          <button
            type="button"
            data-testid="association-badge"
            aria-label={associationLabel}
            className={buttonClass}
            disabled={hideWhenEmpty && isChecking}
            onClick={toggleAssociations}
          >
            <MeshNetworkIcon
              className={variant === 'card' ? 'h-3.5 w-3.5' : 'h-4 w-4'}
              aria-hidden="true"
            />
          </button>
        )}
      </Tooltip>
      {isOpen &&
        ReactDOM.createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            data-testid="association-popover"
          >
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              aria-label="Close associations"
              onClick={() => setIsOpen(false)}
            />
            <div
              className="relative z-10 max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)]"
              role="dialog"
              aria-modal="true"
              aria-label={intl.formatMessage(messages.associations)}
            >
              <button
                type="button"
                className="app-button app-button-default absolute top-2 right-2 z-10 h-8 w-8 rounded-full p-0"
                aria-label="Close associations"
                onClick={() => setIsOpen(false)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
              <AssociationPopover mediaType={associationType} id={id} />
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default AssociationBadge;
