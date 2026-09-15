import { useUser, type UserSettings } from '@app/hooks/useUser';
import type {
  DetailDisclosurePin,
  UserSettingsDetailDisclosureResponse,
} from '@server/interfaces/api/userSettingsInterfaces';
import axios from 'axios';
import { useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import {
  DetailDisclosurePinsMutationState,
  type DetailDisclosurePins,
} from './detailDisclosurePinsMutation';

const defaultPins: DetailDisclosurePins = {
  cast: false,
  crew: false,
  artists: false,
  subjectTags: false,
};

const fromUserSettings = (settings?: UserSettings): DetailDisclosurePins => ({
  cast: settings?.detailDisclosureCastPinned === true,
  crew: settings?.detailDisclosureCrewPinned === true,
  artists: settings?.detailDisclosureArtistsPinned === true,
  subjectTags: settings?.detailDisclosureSubjectTagsPinned === true,
});

const useDetailDisclosurePins = () => {
  const { user, revalidate: revalidateUser } = useUser();
  const userKey = user?.id ? String(user.id) : 'anonymous';
  const endpoint = user?.id
    ? `/api/v1/user/${user.id}/settings/detail-disclosures`
    : null;
  const { data, mutate } = useSWR<UserSettingsDetailDisclosureResponse>(
    endpoint,
    {
      fallbackData: fromUserSettings(user?.settings),
      revalidateOnFocus: false,
    }
  );
  const pins = useMemo<DetailDisclosurePins>(
    () => ({
      ...defaultPins,
      ...fromUserSettings(user?.settings),
      ...data,
    }),
    [data, user?.settings]
  );
  const mutationState = useRef(new DetailDisclosurePinsMutationState());
  mutationState.current.synchronize(userKey, pins);

  const setPinned = useCallback(
    async (section: DetailDisclosurePin, pinned: boolean): Promise<void> => {
      if (!endpoint) {
        return;
      }

      const mutation = mutationState.current.begin(section, pinned);
      try {
        const savedPins = await mutate(
          async () => {
            const response =
              await axios.post<UserSettingsDetailDisclosureResponse>(endpoint, {
                [section]: pinned,
              });
            return response.data;
          },
          {
            optimisticData: mutation.next,
            rollbackOnError: () => mutationState.current.isCurrent(mutation),
            revalidate: false,
          }
        );

        if (mutationState.current.isCurrent(mutation) && savedPins) {
          const normalizedPins = { ...defaultPins, ...savedPins };
          mutationState.current.synchronize(userKey, normalizedPins);
          await revalidateUser();
        }
      } catch (error) {
        const rollbackPins = mutationState.current.rollback(mutation);
        if (rollbackPins) {
          await mutate(rollbackPins, { revalidate: false });
        }
        throw error;
      }
    },
    [endpoint, mutate, revalidateUser, userKey]
  );

  const togglePinned = useCallback(
    async (section: DetailDisclosurePin): Promise<void> => {
      await setPinned(section, !pins[section]);
    },
    [pins, setPinned]
  );

  return { pins, setPinned, togglePinned };
};

export default useDetailDisclosurePins;
