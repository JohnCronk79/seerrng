import logger from '@server/logger';
import { existsSync } from 'fs';
import path from 'path';

const COMMIT_TAG_PATH = path.join(__dirname, '../../committag.json');
let commitTag = 'local';
let buildVersion = 'main';

if (existsSync(COMMIT_TAG_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const buildInfo = require(COMMIT_TAG_PATH);
  commitTag = buildInfo.commitTag;
  buildVersion = buildInfo.buildVersion ?? buildVersion;
  logger.info(`Commit Tag: ${commitTag}`);
}

export const getCommitTag = (): string => {
  return commitTag;
};

export const getBuildVersion = (): string => {
  return buildVersion;
};

export const getAppVersion = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { version } = require('../../package.json');

  let finalVersion = version;

  if (version === '0.1.0') {
    finalVersion = `${getBuildVersion()}-${getCommitTag()}`;
  }

  return finalVersion;
};
