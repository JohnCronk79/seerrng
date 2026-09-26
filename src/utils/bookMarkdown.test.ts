import { normalizeBookOverviewMarkdown } from '@app/utils/bookMarkdown';
import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

describe('normalizeBookOverviewMarkdown', () => {
  it('removes stray emphasis text after an https Markdown link', () => {
    strictEqual(
      normalizeBookOverviewMarkdown(
        "Read [**A Good Girl's Guide to Murder pdf**](https://example.com/book/)**"
      ),
      "Read [**A Good Girl's Guide to Murder pdf**](https://example.com/book/)"
    );
  });

  it('preserves normal Markdown and plain text', () => {
    strictEqual(
      normalizeBookOverviewMarkdown('A **normal** overview.'),
      'A **normal** overview.'
    );
  });
});
