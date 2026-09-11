import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { useEffect } from 'react';

const PlexLoading = () => {
  useEffect(() => {
    const isCompletedReturn =
      new URLSearchParams(window.location.search).get('complete') === '1';

    if (!isCompletedReturn) {
      return;
    }

    // This page is loaded both before Plex authentication and after Plex
    // returns the approved popup. Only the returned page may close itself.
    window.close();
  }, []);

  return (
    <div>
      <LoadingSpinner />
    </div>
  );
};

export default PlexLoading;
