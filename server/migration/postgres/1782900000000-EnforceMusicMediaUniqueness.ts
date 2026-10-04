import { EnforceMusicMediaUniqueness1782900000000 as PortableMusicMediaUniquenessMigration } from '@server/migration/sqlite/1782900000000-EnforceMusicMediaUniqueness';

// The merge and partial-index SQL used by this migration is portable across
// the supported SQLite and PostgreSQL versions.
export class EnforceMusicMediaUniqueness1782900000000 extends PortableMusicMediaUniquenessMigration {
  name = 'EnforceMusicMediaUniqueness1782900000000';
}
