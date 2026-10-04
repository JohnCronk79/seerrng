import { EnforceScreenMediaUniqueness1782600000000 as PortableScreenMediaUniquenessMigration } from '@server/migration/sqlite/1782600000000-EnforceScreenMediaUniqueness';

// The deduplication and partial-index SQL used by this migration is portable
// across the supported SQLite and PostgreSQL versions.
export class EnforceScreenMediaUniqueness1782600000000 extends PortableScreenMediaUniquenessMigration {
  name = 'EnforceScreenMediaUniqueness1782600000000';
}
