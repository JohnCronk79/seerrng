import dataSource from '@server/datasource';
import logger from '@server/logger';
import { getMetadataArgsStorage } from 'typeorm';
import './setup';

import.meta.glob(['../entity/*.ts', '!../entity/*.test.ts'], { eager: true });
import.meta.glob(['../subscriber/*.ts', '!../subscriber/*.test.ts'], {
  eager: true,
});

const metadata = getMetadataArgsStorage();
dataSource.setOptions({
  entities: metadata.tables.map(({ target }) => target),
  migrations: [],
  subscribers: metadata.entitySubscribers.map(({ target }) => target),
});

process.env.NODE_ENV = 'test';

if (process.env.VERBOSE !== 'true') {
  logger.silent = true;
}
