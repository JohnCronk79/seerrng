export type BookshelfProvider =
  | 'hardcover'
  | 'softcover'
  | 'openlibrary'
  | 'googlebooks'
  | 'custom'
  | 'unknown';

export const classifyBookshelfProvider = (
  metadataSource?: string
): BookshelfProvider => {
  const normalizedMetadataSource = metadataSource?.toLowerCase() ?? '';

  if (normalizedMetadataSource.includes('hardcover')) {
    return 'hardcover';
  }

  if (
    normalizedMetadataSource.includes('goodreads') ||
    normalizedMetadataSource.includes('softcover') ||
    normalizedMetadataSource.includes('rreading-glasses') ||
    normalizedMetadataSource.includes('127.0.0.1:8790') ||
    normalizedMetadataSource.includes('localhost:8790')
  ) {
    return 'softcover';
  }

  if (normalizedMetadataSource.includes('openlibrary')) {
    return 'openlibrary';
  }

  if (
    normalizedMetadataSource.includes('googlebooks') ||
    normalizedMetadataSource.includes('google books')
  ) {
    return 'googlebooks';
  }

  if (normalizedMetadataSource.trim()) {
    return 'custom';
  }

  return 'unknown';
};

export const getBookshelfProviderNotice = (
  provider: BookshelfProvider
): string | undefined =>
  provider === 'softcover'
    ? 'Goodreads-compatible metadata source detected. SeerrNG supports this backend.'
    : undefined;
