import { EnforceCanonicalBookIdentifierUniqueness1782800000000 as PortableCanonicalBookIdentifierMigration } from '@server/migration/sqlite/1782800000000-EnforceCanonicalBookIdentifierUniqueness';

// The ranking, repair, and partial-index SQL used by this migration is
// portable across the supported SQLite and PostgreSQL versions.
export class EnforceCanonicalBookIdentifierUniqueness1782800000000 extends PortableCanonicalBookIdentifierMigration {
  name = 'EnforceCanonicalBookIdentifierUniqueness1782800000000';
}
