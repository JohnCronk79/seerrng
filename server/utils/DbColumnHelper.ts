import { isPgsql } from '@server/utils/dbType';
import type { ColumnOptions, ColumnType } from 'typeorm';
import { Column } from 'typeorm';
const pgTypeMapping: { [key: string]: ColumnType } = {
  datetime: 'timestamp with time zone',
};
const sqliteTypeMapping: { [key: string]: ColumnType } = {
  bigint: 'integer',
};

export function resolveDbType(type: ColumnType): ColumnType {
  const typeName = type.toString();
  if (isPgsql && typeName in pgTypeMapping) {
    return pgTypeMapping[typeName];
  }
  if (!isPgsql && typeName in sqliteTypeMapping) {
    return sqliteTypeMapping[typeName];
  }
  return type;
}

export function currentTimestampDefault(): string {
  return isPgsql ? 'CURRENT_TIMESTAMP' : "datetime('now')";
}

export function DbAwareColumn(columnOptions: ColumnOptions) {
  if (columnOptions.type) {
    columnOptions.type = resolveDbType(columnOptions.type);
  }
  return Column(columnOptions);
}
