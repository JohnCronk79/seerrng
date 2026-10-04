import type {
  MbAlbumDetails,
  MbRecordingDetails,
} from '@server/api/musicbrainz/interfaces';

export interface PlaylistReleaseGroupMatch {
  id: string;
  title: string;
  artist: string;
  year?: string;
  releaseType: string;
  confidence: number;
}

const normalize = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(feat\.?|ft\.?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizePlaylistText = normalize;

const similarity = (left: string, right: string): number => {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return 0.9;
  }

  const leftTokens = new Set(normalizedLeft.split(' '));
  const rightTokens = new Set(normalizedRight.split(' '));
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token)
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
};

const artistNames = (album: MbAlbumDetails): string =>
  (album['artist-credit'] ?? []).map((credit) => credit.name).join(' & ');

const scoreAlbum = ({
  title,
  artist,
  album,
}: {
  title: string;
  artist: string;
  album: MbAlbumDetails;
}): number => {
  const titleScore = similarity(title, album.title);
  const artistScore = artist ? similarity(artist, artistNames(album)) : 0;
  const providerScore = Math.max(0, Math.min(100, album.score ?? 0)) / 100;
  return titleScore * 62 + artistScore * 33 + providerScore * 5;
};

const albumToMatch = (
  album: MbAlbumDetails,
  confidence: number
): PlaylistReleaseGroupMatch => ({
  id: album.id,
  title: album.title,
  artist: artistNames(album),
  year: album['first-release-date']?.slice(0, 4) || undefined,
  releaseType: album['primary-type'] ?? 'Album',
  confidence: Math.round(confidence),
});

export const selectBestAlbumMatch = ({
  title,
  artist,
  candidates,
}: {
  title: string;
  artist: string;
  candidates: MbAlbumDetails[];
}): PlaylistReleaseGroupMatch | undefined => {
  const ranked = candidates
    .map((album) => ({ album, score: scoreAlbum({ title, artist, album }) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best) {
    return undefined;
  }

  const minimumScore = artist ? 72 : 84;
  if (best.score < minimumScore) {
    return undefined;
  }

  const second = ranked[1];
  if (second && best.score < 92 && best.score - second.score < 5) {
    return undefined;
  }

  return albumToMatch(best.album, best.score);
};

const releaseGroupPreference = (
  release: MbRecordingDetails['releases'][number]
): number => {
  const group = release['release-group'];
  let preference = 0;
  if (release.status === 'Official') {
    preference += 18;
  }
  if (['Album', 'EP', 'Single'].includes(group['primary-type'])) {
    preference += 10;
  }
  if (group['secondary-types'].includes('Compilation')) {
    preference -= 12;
  }
  if (group['secondary-types'].includes('Live')) {
    preference -= 2;
  }
  return preference;
};

export const selectBestRecordingMatch = ({
  title,
  artist,
  recordings,
}: {
  title: string;
  artist: string;
  recordings: MbRecordingDetails[];
}): PlaylistReleaseGroupMatch | undefined => {
  const rankedRecordings = recordings
    .map((recording) => ({
      recording,
      score:
        similarity(title, recording.title) * 62 +
        (artist
          ? similarity(
              artist,
              recording['artist-credit']
                ?.map((credit) => credit.name)
                .join(' & ') ?? ''
            ) * 33
          : 0) +
        (Math.max(0, Math.min(100, recording.score ?? 0)) / 100) * 5,
    }))
    .sort((left, right) => right.score - left.score);
  const bestRecording = rankedRecordings[0];
  if (!bestRecording || bestRecording.score < (artist ? 72 : 84)) {
    return undefined;
  }

  const candidates = new Map<
    string,
    { release: MbRecordingDetails['releases'][number]; score: number }
  >();
  for (const release of bestRecording.recording.releases) {
    const current = candidates.get(release['release-group'].id);
    const score = bestRecording.score + releaseGroupPreference(release);
    if (!current || score > current.score) {
      candidates.set(release['release-group'].id, { release, score });
    }
  }

  const bestRelease = [...candidates.values()].sort(
    (left, right) => right.score - left.score
  )[0];
  if (!bestRelease) {
    return undefined;
  }

  return {
    id: bestRelease.release['release-group'].id,
    title: bestRelease.release['release-group'].title,
    artist: bestRecording.recording['artist-credit']?.[0]?.name ?? artist,
    year:
      bestRelease.release['first-release-date']?.slice(0, 4) ||
      bestRecording.recording['first-release-date']?.slice(0, 4) ||
      undefined,
    releaseType:
      bestRelease.release['release-group']['primary-type'] || 'Album',
    confidence: Math.round(Math.min(100, bestRecording.score)),
  };
};

export const parseYouTubeTrackTitle = ({
  title,
  artist,
}: {
  title: string;
  artist?: string;
}): { title: string; artist: string } => {
  const cleanedTitle = title
    .replace(
      /\s*(?:\[|\()(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visualizer|hd)(?:\]|\)).*$/iu,
      ''
    )
    .replace(/\s+(?:official\s+)?(?:video|audio|lyrics?)$/iu, '')
    .trim();
  const separators = [' - ', ' – ', ' — ', ' | '];
  const separator = separators.find((candidate) =>
    cleanedTitle.includes(candidate)
  );
  if (separator) {
    const [parsedArtist, ...rest] = cleanedTitle.split(separator);
    if (parsedArtist.trim() && rest.join(separator).trim()) {
      return {
        artist: parsedArtist.trim(),
        title: rest.join(separator).trim(),
      };
    }
  }

  return {
    title: cleanedTitle || title.trim(),
    artist: artist?.trim() ?? '',
  };
};
