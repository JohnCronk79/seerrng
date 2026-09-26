export interface LibraryCopy {
  key: string;
  serviceId: number;
  serviceType: 'radarr' | 'sonarr' | 'lidarr' | 'readarr';
  externalId: number;
  service: string;
  quality: string;
  url: string;
}

export interface LibraryRemovalPlan {
  targets: LibraryCopy[];
  token: string;
}
