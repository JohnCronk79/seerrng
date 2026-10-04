import type ReadarrAPI from '@server/api/servarr/readarr';
import type { ReadarrBookLookupResult } from '@server/api/servarr/readarr';
import logger from '@server/logger';

export const isAddableBookshelfLookupResult = (
  result: ReadarrBookLookupResult
): boolean =>
  !!(
    result.foreignBookId?.trim() &&
    result.title?.trim() &&
    result.author?.foreignAuthorId?.trim() &&
    result.editions?.some((edition) => !!edition.foreignEditionId?.trim())
  );

const parseAuthorName = (
  result: ReadarrBookLookupResult
): string | undefined => {
  const authorTitle = result.authorTitle?.trim();
  if (!authorTitle) return undefined;

  const titleIndex = authorTitle
    .toLocaleLowerCase()
    .lastIndexOf(result.title.toLocaleLowerCase());
  const rawAuthorName =
    titleIndex > 0 ? authorTitle.slice(0, titleIndex).trim() : authorTitle;
  const [lastName, ...firstNameParts] = rawAuthorName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!lastName) return undefined;

  return firstNameParts.length
    ? `${firstNameParts.join(' ')} ${lastName}`
    : lastName;
};

const normalizeName = (name: string): string =>
  name
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Repairs partial responses from Readarr-compatible metadata providers while
 * preserving their native IDs. No Goodreads, Hardcover, or other provider ID
 * is interpreted as an Open Library identifier here.
 */
export const hydrateBookshelfLookupResult = async (
  readarr: Pick<ReadarrAPI, 'lookupAuthor'>,
  result: ReadarrBookLookupResult,
  normalizedIsbn?: string,
  loadAuthor?: (
    name: string
  ) => Promise<ReadarrBookLookupResult['author'] | undefined>
): Promise<ReadarrBookLookupResult> => {
  let author = result.author;

  if (!author?.foreignAuthorId?.trim()) {
    const authorName = author?.authorName?.trim() || parseAuthorName(result);
    if (authorName) {
      try {
        const resolvedAuthor = loadAuthor
          ? await loadAuthor(authorName)
          : await readarr.lookupAuthor(authorName).then((authors) => {
              const complete = authors.filter(
                (candidate) =>
                  !!candidate.foreignAuthorId?.trim() &&
                  !!candidate.authorName?.trim()
              );
              return (
                complete.find(
                  (candidate) =>
                    normalizeName(candidate.authorName) ===
                    normalizeName(authorName)
                ) ?? complete[0]
              );
            });

        if (resolvedAuthor?.foreignAuthorId?.trim()) {
          author = {
            ...author,
            ...resolvedAuthor,
            authorName: resolvedAuthor.authorName ?? author?.authorName,
          };
        }
      } catch (error) {
        logger.warn(
          'Bookshelf author lookup failed during metadata hydration.',
          {
            label: 'Readarr',
            authorName,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          }
        );
      }
    }
  }

  const hasUsableEdition = result.editions?.some(
    (edition) => !!edition.foreignEditionId?.trim()
  );
  const editions = hasUsableEdition
    ? result.editions
    : result.foreignEditionId?.trim()
      ? [
          {
            foreignEditionId: result.foreignEditionId,
            title: result.title,
            isbn13: normalizedIsbn,
            monitored: true,
          },
        ]
      : result.editions;

  return { ...result, author, editions };
};
