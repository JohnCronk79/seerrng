export type PlaylistProvider = 'spotify' | 'youtube';

export type PlaylistMatchStatus = 'matched' | 'unmatched' | 'ambiguous';

export interface PlaylistResolutionItem {
  id: string;
  title: string;
  artist?: string;
  year?: string;
  image?: string | null;
  releaseType?: string;
  sourceTitle: string;
  sourceArtist?: string;
  sourceUrl?: string;
  matchStatus: PlaylistMatchStatus;
  matchReason?: string;
}

export interface PlaylistResolutionResponse {
  provider: PlaylistProvider;
  name: string;
  url: string;
  totalItems: number;
  matchedItems: number;
  items: PlaylistResolutionItem[];
}
