export type SeasonEpisodeSelection = {
  seasonNumber: number;
  /** Undefined means the entire season. */
  episodeNumbers?: number[];
};
