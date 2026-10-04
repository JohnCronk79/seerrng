const UPSTREAM_TMDB_API_KEY = '431a8708161bcd1f1fbe7536137e61ed';

const getReadAccessToken = (): string | undefined =>
  process.env.TMDB_READ_ACCESS_TOKEN?.trim() || undefined;

const getConfiguredApiKey = (): string | undefined =>
  process.env.TMDB_API_KEY?.trim() || undefined;

export type TmdbAuthSource =
  'TMDB_READ_ACCESS_TOKEN' | 'TMDB_API_KEY' | 'SeerrNG bundled key';

export const getTmdbAuthSource = (): TmdbAuthSource => {
  if (getReadAccessToken()) {
    return 'TMDB_READ_ACCESS_TOKEN';
  }

  return getConfiguredApiKey() ? 'TMDB_API_KEY' : 'SeerrNG bundled key';
};

export const getTmdbAuthParams = (): Record<string, string> => {
  // TMDB accepts either application-key or bearer-token authentication. Do
  // not send a stale API key alongside a valid read-access token.
  if (getReadAccessToken()) {
    return {};
  }

  return { api_key: getConfiguredApiKey() ?? UPSTREAM_TMDB_API_KEY };
};

export const getTmdbAuthHeaders = (): Record<string, string> => {
  const token = getReadAccessToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }

  return {};
};
