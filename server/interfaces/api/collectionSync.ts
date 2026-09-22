export interface CollectionDestination {
  libraryId: string;
  libraryName: string;
  state: 'exists' | 'missing' | 'unknown' | 'conflict';
  count: number;
  managed: boolean;
  /** Binds confirmation to the verified server, library and remote collection. */
  removalToken?: string;
}

export interface CollectionSyncStatus {
  supported: boolean;
  checkedAt: number;
  destinations: CollectionDestination[];
}
