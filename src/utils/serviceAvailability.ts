export interface OptionalServiceAvailability {
  musicEnabled: boolean;
  booksEnabled: boolean;
  comicsEnabled: boolean;
}

export const isOptionalCatalogPathEnabled = (
  path: string,
  availability: OptionalServiceAvailability
): boolean => {
  if (path === '/discover/music') {
    return availability.musicEnabled;
  }

  if (path === '/discover/comics') {
    return availability.comicsEnabled;
  }

  return (
    !['/discover/books', '/discover/audiobooks'].includes(path) ||
    availability.booksEnabled
  );
};
