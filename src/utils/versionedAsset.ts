const assetVersion = encodeURIComponent(process.env.commitTag ?? 'local');

const versionedAsset = (path: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}v=${assetVersion}`;

export default versionedAsset;
