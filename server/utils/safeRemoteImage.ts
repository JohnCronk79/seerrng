import { DEFAULT_EXTERNAL_API_TIMEOUT_MS } from '@server/api/externalapi';
import {
  createSafeHttpRequestOptions,
  createSafeHttpUrl,
  stringifySafeHttpUrl,
} from '@server/utils/security';
import axios from 'axios';

export const MAX_SAFE_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;

const SAFE_RASTER_CONTENT_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/tiff',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/x-icon',
]);

export type SafeRemoteImage = {
  imageBuffer: Buffer;
  contentType: string;
};

export const normalizeSafeRasterImage = (
  data: ArrayBuffer | Uint8Array,
  rawContentType: unknown
): SafeRemoteImage => {
  const contentType = String(rawContentType ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (!SAFE_RASTER_CONTENT_TYPES.has(contentType)) {
    throw new Error('Image response is not a supported raster image.');
  }

  const imageBuffer = Buffer.from(
    data instanceof ArrayBuffer ? new Uint8Array(data) : data
  );
  if (imageBuffer.length > MAX_SAFE_REMOTE_IMAGE_BYTES) {
    throw new Error('Image response exceeds the maximum allowed size.');
  }

  return { imageBuffer, contentType };
};

export const fetchSafeRemoteImage = async (
  remoteUrl: string
): Promise<SafeRemoteImage> => {
  const safeUrl = await createSafeHttpUrl(remoteUrl);
  if (!safeUrl) {
    throw new Error('Remote image URL is not safe to request.');
  }

  const response = await axios.get<ArrayBuffer>(stringifySafeHttpUrl(safeUrl), {
    ...createSafeHttpRequestOptions(false, true, true),
    responseType: 'arraybuffer',
    timeout: DEFAULT_EXTERNAL_API_TIMEOUT_MS,
    maxContentLength: MAX_SAFE_REMOTE_IMAGE_BYTES,
    maxBodyLength: MAX_SAFE_REMOTE_IMAGE_BYTES,
    headers: { Accept: 'image/*' },
  });

  return normalizeSafeRasterImage(
    response.data,
    response.headers['content-type']
  );
};
