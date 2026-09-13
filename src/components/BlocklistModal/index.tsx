import BlocklistConfirmationModal from '@app/components/BlocklistConfirmationModal';

interface BlocklistModalProps {
  tmdbId: number;
  type: 'movie' | 'tv' | 'collection';
  show: boolean;
  onComplete?: () => void;
  onCancel?: () => void;
  isUpdating?: boolean;
}

const BlocklistModal = ({
  show,
  onComplete,
  onCancel,
  isUpdating,
}: BlocklistModalProps) => {
  return (
    <BlocklistConfirmationModal
      show={show}
      onCancel={onCancel}
      onComplete={onComplete}
      isUpdating={isUpdating}
    />
  );
};

export default BlocklistModal;
