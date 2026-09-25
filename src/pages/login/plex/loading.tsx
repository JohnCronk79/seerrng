import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { useEffect } from 'react';

const PlexLoading = () => {
  useEffect(() => {
    const isCompletedReturn =
      new URLSearchParams(window.location.search).get('complete') === '1';

    if (!isCompletedReturn) {
      return;
    }

    window.close();
  }, []);

  return (
    <div>
      <LoadingSpinner />
    </div>
  );
};

export default PlexLoading;
