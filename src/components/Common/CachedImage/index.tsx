import useSettings from '@app/hooks/useSettings';
import type { CacheableImageType } from '@app/utils/imageCache';
import {
  AVATAR_FALLBACK_IMAGE,
  getImageCacheUrl,
  getImageErrorFallback,
  getInitialImageUrl,
} from '@app/utils/imageCache';
import { UserIcon } from '@heroicons/react/24/solid';
import type { ImageLoader, ImageProps } from 'next/image';
import Image from 'next/image';
import { memo, useEffect, useMemo, useState } from 'react';

const AVATAR_PRELOAD_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

const imageLoader: ImageLoader = ({ src }) => src;

export type CachedImageProps = ImageProps & {
  src: string;
  type: CacheableImageType;
};

/**
 * The CachedImage component should be used wherever
 * we want to offer the option to locally cache images.
 **/
const CachedImage = memo(
  ({
    src,
    type,
    decoding = 'async',
    loading,
    priority,
    onError,
    ...props
  }: CachedImageProps) => {
    const { currentSettings } = useSettings();

    const imageUrl = useMemo(
      () =>
        getImageCacheUrl({
          cacheImages: currentSettings.cacheImages,
          src,
          type,
        }),
      [currentSettings.cacheImages, src, type]
    );
    const [activeImageUrl, setActiveImageUrl] = useState(() =>
      getInitialImageUrl(type, imageUrl)
    );

    useEffect(() => {
      if (type !== 'avatar' || imageUrl === AVATAR_FALLBACK_IMAGE) {
        setActiveImageUrl(imageUrl);
        return;
      }

      setActiveImageUrl(AVATAR_FALLBACK_IMAGE);

      let avatarPreloader: HTMLImageElement | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      let retryIndex = 0;
      let isCancelled = false;

      const preloadAvatar = () => {
        avatarPreloader = new window.Image();
        avatarPreloader.onload = () => {
          if (!isCancelled) {
            setActiveImageUrl(imageUrl);
          }
        };
        avatarPreloader.onerror = () => {
          if (
            isCancelled ||
            retryIndex >= AVATAR_PRELOAD_RETRY_DELAYS_MS.length
          ) {
            return;
          }

          const retryDelay = AVATAR_PRELOAD_RETRY_DELAYS_MS[retryIndex++];
          retryTimer = setTimeout(preloadAvatar, retryDelay);
        };
        avatarPreloader.src = imageUrl;
      };

      preloadAvatar();

      return () => {
        isCancelled = true;
        if (retryTimer) {
          clearTimeout(retryTimer);
        }
        if (avatarPreloader) {
          avatarPreloader.onload = null;
          avatarPreloader.onerror = null;
        }
      };
    }, [imageUrl, type]);

    if (type === 'avatar' && activeImageUrl === AVATAR_FALLBACK_IMAGE) {
      return (
        <UserIcon
          aria-label={typeof props.alt === 'string' ? props.alt : undefined}
          className={`inline-flex p-[15%] text-indigo-500 ${props.className ?? ''}`}
          role={props.alt ? 'img' : undefined}
        />
      );
    }

    return (
      <Image
        unoptimized
        loader={imageLoader}
        src={activeImageUrl}
        decoding={decoding}
        loading={priority ? undefined : (loading ?? 'lazy')}
        priority={priority}
        onError={(event) => {
          const fallbackImage = getImageErrorFallback(type, activeImageUrl);
          if (fallbackImage) {
            setActiveImageUrl(fallbackImage);
          }
          onError?.(event);
        }}
        {...props}
      />
    );
  }
);

CachedImage.displayName = 'CachedImage';

export default CachedImage;
