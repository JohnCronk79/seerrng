import CuratedCollectionDetails from '@app/components/CollectionDetails/CuratedCollectionDetails';
import Modal from '@app/components/Common/Modal';
import { Transition } from '@headlessui/react';
import { useEffect } from 'react';

// The collection owns the catalogue, card layout, filters and enrichment queues.
// Submission controls are deliberately absent during the discography redesign.
export default function DiscographyRequestModal({
  show,
  artistId,
  artistName,
  onCancel,
}: {
  show: boolean;
  artistId: string;
  artistName: string;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!show) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCancel();
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [show, onCancel]);
  if (!show) return null;
  return (
    <Transition show={show} as="div">
      <Modal
        ariaLabel={`${artistName} Discography`}
        onCancel={onCancel}
        hideActions
        dialogClass="request-modal-site-surface discography-dialog"
      >
        <CuratedCollectionDetails
          key={artistId}
          kind="music"
          id={artistId}
          discographyArtist={artistName}
        />
      </Modal>
    </Transition>
  );
}
