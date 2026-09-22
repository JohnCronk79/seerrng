import { matchesMusicReleaseType } from '@server/constants/musicReleaseTypes';
import type { CuratedCollectionMember } from '@server/models/CuratedCollection';

export type MusicCollectionFilters = {
  releaseType: string;
  genre: string;
  year: string;
};
export const EMPTY_MUSIC_COLLECTION_FILTERS: MusicCollectionFilters = {
  releaseType: '',
  genre: '',
  year: '',
};

export function filterMusicCollection(
  parts: CuratedCollectionMember[],
  filters: MusicCollectionFilters
) {
  return parts.filter((part) => {
    // The subtitle fallback keeps an already-open tab compatible during a dev reload.
    const types = part.subtitle?.split(' · ') ?? [];
    return (
      matchesMusicReleaseType(
        part.primaryType ?? types[0],
        part.secondaryTypes ?? types.slice(1),
        filters.releaseType
      ) &&
      (!filters.genre ||
        part.genres.some(
          (genre) => genre.toLowerCase() === filters.genre.toLowerCase()
        )) &&
      (!filters.year ||
        (filters.year === 'unknown'
          ? !/^\d{4}/.test(part.releaseDate)
          : part.releaseDate.slice(0, 4) === filters.year))
    );
  });
}

export function musicCollectionFilterOptions(parts: CuratedCollectionMember[]) {
  return {
    genres: [
      ...new Map(
        parts
          .flatMap((part) => part.genres)
          .map((name) => [name.trim().toLowerCase(), name.trim()])
      ).entries(),
    ]
      .filter(([value]) => value)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
    years: [
      ...new Set(
        parts
          .map((part) => /^\d{4}/.exec(part.releaseDate)?.[0])
          .filter((year): year is string => !!year)
      ),
    ]
      .sort((a, b) => b.localeCompare(a))
      .map((year) => ({ value: year, label: year })),
    unknownYear: parts.some((part) => !/^\d{4}/.test(part.releaseDate)),
  };
}
