interface CoverArtThumbnails {
  250: string;
}

interface CoverArtImage {
  approved: boolean;
  front: boolean;
  id: number | string;
  thumbnails: CoverArtThumbnails;
}

export interface CoverArtResponse {
  images: CoverArtImage[];
  release: string;
}
