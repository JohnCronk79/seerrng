import type {
  TmdbMovieResult,
  TmdbPersonCreditCast,
  TmdbPersonCreditCrew,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';

export const clampNumber = (value: number | undefined, fallback = 0): number =>
  Number.isFinite(value) ? (value as number) : fallback;

export const getRecencyScore = (date?: string): number => {
  const year = Number(date?.slice(0, 4));

  if (!Number.isFinite(year)) {
    return 0;
  }

  const currentYear = new Date().getUTCFullYear();

  return Math.max(0, 30 - Math.max(0, currentYear - year));
};

export const scoreTmdbResult = ({
  popularity,
  vote_average: voteAverage,
  vote_count: voteCount,
  date,
}: {
  popularity: number;
  vote_average: number;
  vote_count: number;
  date?: string;
}): number => {
  const popularityScore = Math.log10(clampNumber(popularity) + 1) * 24;
  const voteCountScore = Math.log10(clampNumber(voteCount) + 1) * 20;
  const voteAverageScore = clampNumber(voteAverage) * 8;
  const recencyScore = getRecencyScore(date) * 0.5;

  return popularityScore + voteCountScore + voteAverageScore + recencyScore;
};

export const getSeededJitter = (seed: string, index: number): number => {
  let hash = 2166136261;
  const value = `${seed}:${index}`;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
};

export const rankByQualityScore = <T>(
  results: T[],
  getScore: (result: T) => number,
  jitterRatio = 0.08,
  jitterFloor = 4,
  seed?: string
): T[] =>
  [...results]
    .map((result, index) => {
      const score = getScore(result);
      const jitter = seed ? getSeededJitter(seed, index) : Math.random();

      return {
        result,
        rank:
          score + jitter * Math.max(Math.abs(score) * jitterRatio, jitterFloor),
      };
    })
    .sort((a, b) => b.rank - a.rank)
    .map(({ result }) => result);

export const rankTmdbMovieResults = (
  results: TmdbMovieResult[],
  seed?: string,
  options: { jitterRatio?: number; jitterFloor?: number } = {}
): TmdbMovieResult[] =>
  rankByQualityScore(
    results,
    (result) => scoreTmdbResult({ ...result, date: result.release_date }),
    options.jitterRatio,
    options.jitterFloor,
    seed
  );

export const rankTmdbTvResults = (
  results: TmdbTvResult[],
  seed?: string,
  options: { jitterRatio?: number; jitterFloor?: number } = {}
): TmdbTvResult[] =>
  rankByQualityScore(
    results,
    (result) => scoreTmdbResult({ ...result, date: result.first_air_date }),
    options.jitterRatio,
    options.jitterFloor,
    seed
  );

const getPersonCreditDate = (
  credit: TmdbPersonCreditCast | TmdbPersonCreditCrew
): string | undefined =>
  credit.media_type === 'tv' ? credit.first_air_date : credit.release_date;

export const rankTmdbPersonCredits = <
  T extends TmdbPersonCreditCast | TmdbPersonCreditCrew,
>(
  results: T[]
): T[] =>
  [...results].sort(
    (a, b) =>
      scoreTmdbResult({ ...b, date: getPersonCreditDate(b) }) -
      scoreTmdbResult({ ...a, date: getPersonCreditDate(a) })
  );
