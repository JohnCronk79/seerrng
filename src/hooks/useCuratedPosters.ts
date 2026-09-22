import useSettings from '@app/hooks/useSettings';
import { mapWithConcurrency } from '@app/utils/concurrency';
import { getImageCacheUrl } from '@app/utils/imageCache';
import type { CuratedCollectionMember } from '@server/models/CuratedCollection';
import axios from 'axios';
import { useEffect, useState } from 'react';

const BATCH_SIZE = 50;

export const preloadCuratedPoster = (url: string, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const image = new window.Image();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      image.onload = null;
      image.onerror = null;
      resolve();
    };
    const timer = setTimeout(finish, 30000);
    signal.addEventListener('abort', finish, { once: true });
    image.onload = finish;
    image.onerror = finish;
    image.src = url;
  });

type PosterSnapshot = {
  scope: string;
  posters: Record<string, string | null>;
  complete: boolean;
};

export default function useCuratedPosters(
  collectionId: string,
  parts: CuratedCollectionMember[]
) {
  const { currentSettings } = useSettings();
  const cacheImages = currentSettings.cacheImages;
  const partKey = JSON.stringify(
    parts.map(({ id, posterPath }) => [id, posterPath])
  );
  const scope = JSON.stringify([collectionId, partKey, cacheImages]);
  const [snapshot, setSnapshot] = useState<PosterSnapshot>({
    scope: '',
    posters: {},
    complete: false,
  });
  useEffect(() => {
    if (!collectionId) return;
    const controller = new AbortController();
    const entries = JSON.parse(partKey) as [string, string | undefined][];
    const posters: Record<string, string | null> = {};
    setSnapshot({ scope, posters: {}, complete: false });
    const load = async () => {
      for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
        if (controller.signal.aborted) return;
        const batch = entries.slice(offset, offset + BATCH_SIZE);
        await mapWithConcurrency(batch, 4, async ([id, existingPath]) => {
          if (controller.signal.aborted) return;
          let posterPath = existingPath ?? null;
          if (!posterPath) {
            try {
              const response = await axios.get<{ posterPath: string | null }>(
                `/api/v1/music/${encodeURIComponent(id)}/artwork`,
                { timeout: 30000, signal: controller.signal }
              );
              posterPath = response.data.posterPath;
            } catch {
              // A failed lookup must not prevent later batches from loading.
            }
          }
          if (posterPath && !controller.signal.aborted) {
            await preloadCuratedPoster(
              getImageCacheUrl({ cacheImages, src: posterPath, type: 'music' }),
              controller.signal
            );
          }
          posters[id] = posterPath;
        });
        if (!controller.signal.aborted)
          setSnapshot({ scope, posters: { ...posters }, complete: false });
      }
      if (!controller.signal.aborted)
        setSnapshot({ scope, posters: { ...posters }, complete: true });
    };
    void load();
    return () => controller.abort();
  }, [scope, collectionId, partKey, cacheImages]);
  return {
    posters: snapshot.scope === scope ? snapshot.posters : {},
    complete: snapshot.scope === scope && snapshot.complete,
  };
}
