import type { Request, Response } from 'express';

const ONE_DAY = 24 * 60 * 60;
const THIRTY_DAYS = 30 * ONE_DAY;
const ONE_YEAR = 365 * ONE_DAY;

const PUBLIC_IMAGE_EXTENSIONS = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i;
const PUBLIC_FONT_EXTENSIONS = /\.(?:otf|ttf|woff2?)$/i;
const PUBLIC_MEDIA_EXTENSIONS =
  /\.(?:aac|flac|m4a|mp3|mp4|oga|ogg|ogv|opus|wav|webm)$/i;
const PUBLIC_DOCUMENT_EXTENSIONS = /\.(?:json|txt|vtt|xml)$/i;
const PUBLIC_RUNTIME_EXTENSIONS = /\.(?:css|js|mjs|wasm|map)$/i;

const oneDayCacheControl = `public, max-age=${ONE_DAY}, stale-while-revalidate=${THIRTY_DAYS}, stale-if-error=${ONE_DAY}`;
const thirtyDayCacheControl = `public, max-age=${THIRTY_DAYS}, stale-while-revalidate=${THIRTY_DAYS}, stale-if-error=${ONE_DAY}`;

export const getStaticAssetCacheControl = (
  pathname: string
): string | undefined => {
  if (pathname === '/sw.js') {
    return 'no-cache';
  }

  if (pathname === '/offline.html') {
    return oneDayCacheControl;
  }

  if (pathname === '/site.webmanifest' || pathname === '/robots.txt') {
    return oneDayCacheControl;
  }

  if (pathname.startsWith('/_next/static/')) {
    return `public, max-age=${ONE_YEAR}, immutable`;
  }

  if (
    PUBLIC_IMAGE_EXTENSIONS.test(pathname) ||
    PUBLIC_FONT_EXTENSIONS.test(pathname) ||
    PUBLIC_MEDIA_EXTENSIONS.test(pathname) ||
    PUBLIC_DOCUMENT_EXTENSIONS.test(pathname) ||
    PUBLIC_RUNTIME_EXTENSIONS.test(pathname)
  ) {
    return thirtyDayCacheControl;
  }

  return undefined;
};

export const setStaticAssetCacheControl = (
  req: Pick<Request, 'path'>,
  res: Pick<Response, 'setHeader'>
): void => {
  const cacheControl = getStaticAssetCacheControl(req.path);

  if (cacheControl) {
    res.setHeader('Cache-Control', cacheControl);
  }
};
