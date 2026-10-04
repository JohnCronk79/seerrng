const plexPlaylistKeyPattern =
  /^(\/playlists\/[A-Za-z0-9._~-]{1,128})\/items$/u;

export const buildPlexPlaylistWebUrl = ({
  webAppUrl,
  machineIdentifier,
  playlistKey,
}: {
  webAppUrl?: string;
  machineIdentifier: string;
  playlistKey: string;
}): string => {
  const playlistKeyMatch = playlistKey.match(plexPlaylistKeyPattern);
  if (!playlistKeyMatch) {
    throw new Error('Plex returned an invalid playlist content key.');
  }
  const playlistPageKey = playlistKeyMatch[1];

  const baseUrl = (webAppUrl || 'https://app.plex.tv/desktop').replace(
    /\/+$/u,
    ''
  );
  return `${baseUrl}#!/server/${encodeURIComponent(
    machineIdentifier
  )}/playlist?key=${encodeURIComponent(playlistPageKey)}`;
};
