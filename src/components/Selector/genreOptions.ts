import type { TmdbGenre } from '@server/api/themoviedb/interfaces';

export type GenreSelectorOption = {
  label: string;
  value: number;
};

export const getGenreSelectorOptions = (
  genres: TmdbGenre[],
  inputValue = ''
): GenreSelectorOption[] => {
  const normalizedInput = inputValue.trim().toLocaleLowerCase();

  return genres
    .map((genre) => ({ label: genre.name, value: genre.id }))
    .filter(
      ({ label }) =>
        Boolean(label) && label.toLocaleLowerCase().includes(normalizedInput)
    );
};
