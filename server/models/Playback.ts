import type { MediaServerType } from '@server/constants/server';

export interface PlaybackDevice {
  id: string;
  name: string;
  client: string;
  platform?: string;
  serverType: MediaServerType;
}

export interface PlaybackCatalogItem {
  id: string;
  title: string;
  index: number;
  parentIndex?: number;
  kind: 'movie' | 'episode' | 'track';
  available: true;
}

export interface PlaybackCatalogGroup {
  id: string;
  title: string;
  index: number;
  available: boolean;
  items: PlaybackCatalogItem[];
}

export interface PlaybackCatalogResponse {
  mediaId: number;
  serverType: MediaServerType;
  is4k: boolean;
  rootItem?: PlaybackCatalogItem;
  groups: PlaybackCatalogGroup[];
}

export interface PlaybackCommandBody {
  deviceId: string;
  itemIds: string[];
  is4k?: boolean;
}

export interface PlaybackPlaylistBody {
  itemIds: string[];
  is4k?: boolean;
}

export interface PlaybackPlaylistResponse {
  url: string;
}
