import useSettings from '@app/hooks/useSettings';
import PlexOAuth from '@app/utils/plex';
import { useEffect, useRef, useState } from 'react';

const plexOAuth = new PlexOAuth();

function usePlexLogin({
  onAuthToken,
  onError,
}: {
  onAuthToken: (authToken: string) => void;
  onError?: (err: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const attemptRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const { currentSettings } = useSettings();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (attemptRef.current !== undefined) {
        plexOAuth.cancelLogin(attemptRef.current);
      }
    };
  }, []);

  const getPlexLogin = async (attemptId: number) => {
    try {
      const authToken = await plexOAuth.login(
        currentSettings.plexClientIdentifier,
        attemptId
      );
      if (mountedRef.current && attemptRef.current === attemptId) {
        onAuthToken(authToken);
      }
    } catch (e) {
      if (mountedRef.current && attemptRef.current === attemptId && onError) {
        onError(e.message);
      }
    } finally {
      if (mountedRef.current && attemptRef.current === attemptId) {
        attemptRef.current = undefined;
        setLoading(false);
      }
    }
  };

  const login = () => {
    if (attemptRef.current !== undefined) {
      return;
    }
    setLoading(true);
    const attemptId = plexOAuth.preparePopup();
    attemptRef.current = attemptId;
    void getPlexLogin(attemptId);
  };

  return { loading, login };
}

export default usePlexLogin;
