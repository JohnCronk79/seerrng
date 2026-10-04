import type { MigrationInterface } from 'typeorm';

export class WidenUserPermissions1781300000000 implements MigrationInterface {
  name = 'WidenUserPermissions1781300000000';

  public async up(): Promise<void> {
    // SQLite INTEGER already stores signed 64-bit values.
  }

  public async down(): Promise<void> {
    // SQLite INTEGER already stores signed 64-bit values.
  }
}
