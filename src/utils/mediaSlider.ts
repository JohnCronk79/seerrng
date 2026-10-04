export const MEDIA_SLIDER_TITLE_LIMIT = 20;

export const hasMediaSliderResults = (
  pages: { results?: unknown[] }[] | undefined
): boolean => pages?.some((page) => (page.results?.length ?? 0) > 0) ?? false;

export const shouldShowMoreSliderCard = ({
  hasLink,
  loadedTitleCount,
  totalResults,
}: {
  hasLink: boolean;
  loadedTitleCount: number;
  totalResults: number;
}): boolean =>
  hasLink &&
  (loadedTitleCount > MEDIA_SLIDER_TITLE_LIMIT ||
    totalResults > MEDIA_SLIDER_TITLE_LIMIT);
