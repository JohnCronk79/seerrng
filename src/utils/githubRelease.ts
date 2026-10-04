import { getSafeHttpsHref } from './safeUrl';

export const MAX_GITHUB_RELEASES = 20;
export const MAX_GITHUB_RELEASE_BODY_LENGTH = 256 * 1024;
const MAX_GITHUB_RELEASE_NAME_LENGTH = 512;
const MAX_GITHUB_RELEASE_DATE_LENGTH = 64;

export interface SafeGithubRelease {
  body: string;
  created_at: string;
  html_url: string;
  id: number;
  name: string;
}

export const sanitizeGithubReleaseResponse = (
  value: unknown
): SafeGithubRelease[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_GITHUB_RELEASES).flatMap((rawRelease) => {
    if (!rawRelease || typeof rawRelease !== 'object') {
      return [];
    }

    const release = rawRelease as Record<string, unknown>;
    const rawName =
      typeof release.name === 'string' && release.name.trim()
        ? release.name
        : release.tag_name;
    const rawDate =
      typeof release.created_at === 'string'
        ? release.created_at
        : release.published_at;
    const htmlUrl = getSafeHttpsHref(
      typeof release.html_url === 'string' ? release.html_url : undefined
    );

    if (
      !Number.isSafeInteger(release.id) ||
      (release.id as number) <= 0 ||
      typeof rawName !== 'string' ||
      !rawName.trim() ||
      typeof rawDate !== 'string' ||
      rawDate.length > MAX_GITHUB_RELEASE_DATE_LENGTH ||
      !Number.isFinite(Date.parse(rawDate)) ||
      !htmlUrl ||
      new URL(htmlUrl).hostname !== 'github.com'
    ) {
      return [];
    }

    return [
      {
        id: release.id as number,
        name: rawName.slice(0, MAX_GITHUB_RELEASE_NAME_LENGTH),
        created_at: rawDate,
        html_url: htmlUrl,
        body:
          typeof release.body === 'string'
            ? release.body.slice(0, MAX_GITHUB_RELEASE_BODY_LENGTH)
            : '',
      },
    ];
  });
};
