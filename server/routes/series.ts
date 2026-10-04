import { findBookMediaForBookResults } from '@server/lib/bookMediaMatcher';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  getBookshelfSeriesDetails,
  parseBookshelfSeriesId,
} from '@server/utils/bookshelfCatalog';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const seriesRoutes = Router();

seriesRoutes.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
  })
);

seriesRoutes.get<{ id: string }>('/:id', async (req, res, next) => {
  if (!parseBookshelfSeriesId(req.params.id)) {
    return res.status(404).json({ status: 404, message: 'Series not found.' });
  }

  try {
    const series = await getBookshelfSeriesDetails(
      getSettings().readarr,
      req.params.id
    );
    if (!series) {
      return res
        .status(404)
        .json({ status: 404, message: 'Series not found.' });
    }

    const mediaByBookId = await findBookMediaForBookResults(
      series.books,
      req.user
    );

    return res.status(200).json({
      ...series,
      books: series.books.map((book) => ({
        ...book,
        mediaInfo: mediaByBookId.get(book.id),
      })),
    });
  } catch (error) {
    logger.warn('Failed to retrieve a Bookshelf book series.', {
      label: 'Series',
      seriesId: req.params.id,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    return next({ status: 503, message: 'Unable to retrieve this series.' });
  }
});

export default seriesRoutes;
