import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';

export class CollectionSourcesAndSelections1790012000000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    await runner.addColumns('collection_link', [
      new TableColumn({
        name: 'sourceType',
        type: 'varchar',
        length: '16',
        default: "'movie'",
      }),
      new TableColumn({
        name: 'sourceId',
        type: 'varchar',
        length: '128',
        isNullable: true,
      }),
      new TableColumn({ name: 'seenIds', type: 'text', isNullable: true }),
    ]);
  }
  public async down(runner: QueryRunner): Promise<void> {
    await runner.dropColumns('collection_link', [
      'seenIds',
      'sourceId',
      'sourceType',
    ]);
  }
}
