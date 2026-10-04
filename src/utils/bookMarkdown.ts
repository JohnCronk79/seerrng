/** Removes a stray closing emphasis marker sometimes appended to a Markdown link. */
export const normalizeBookOverviewMarkdown = (overview: string): string =>
  overview.replace(/(\]\(https:\/\/[^)\s]+\))\*{2}(?=\s|$)/g, '$1');
