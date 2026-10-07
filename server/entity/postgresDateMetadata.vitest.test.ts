import { afterEach, describe, expect, it, vi } from 'vitest';

describe('PostgreSQL entity date metadata', () => {
  afterEach(() => {
    vi.doUnmock('@server/utils/dbType');
    vi.resetModules();
  });

  it('builds metadata for date columns on entities added in SeerrNG 3.52', async () => {
    vi.resetModules();
    vi.doMock('@server/utils/dbType', () => ({ isPgsql: true }));

    const { DataSource, getMetadataArgsStorage } = await import('typeorm');
    const [
      { default: ReaderDeliveryGrouping },
      { default: GameLibraryAccount },
      { default: GameLibraryEntry },
    ] = await Promise.all([
      import('./ReaderDeliveryGrouping'),
      import('./GameLibraryAccount'),
      import('./GameLibraryEntry'),
    ]);

    const source = new DataSource({
      type: 'postgres',
      database: 'metadata-test',
      entities: [ReaderDeliveryGrouping],
    });
    await (
      source as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();

    const metadata = getMetadataArgsStorage();
    for (const target of [
      ReaderDeliveryGrouping,
      GameLibraryAccount,
      GameLibraryEntry,
    ]) {
      const updatedAt = metadata.columns.find(
        (column) =>
          column.target === target && column.propertyName === 'updatedAt'
      );

      expect(updatedAt?.options.type).toBe('timestamp with time zone');
    }
  });
});
