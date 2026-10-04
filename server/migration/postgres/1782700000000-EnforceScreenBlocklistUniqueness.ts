import { EnforceScreenBlocklistUniqueness1782700000000 as PortableScreenBlocklistUniquenessMigration } from '@server/migration/sqlite/1782700000000-EnforceScreenBlocklistUniqueness';

// The deduplication and partial-index SQL used by this migration is portable
// across the supported SQLite and PostgreSQL versions.
export class EnforceScreenBlocklistUniqueness1782700000000 extends PortableScreenBlocklistUniquenessMigration {
  name = 'EnforceScreenBlocklistUniqueness1782700000000';
}
