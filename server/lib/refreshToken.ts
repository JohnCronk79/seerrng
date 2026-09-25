import PlexTvAPI from '@server/api/plextv';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import logger from '@server/logger';
import { forEachPlexTokenUser } from './plexTokenUserBatches';

class RefreshToken {
  public async run() {
    await forEachPlexTokenUser((user) => this.refreshUserToken(user));
  }

  private async refreshUserToken(user: User) {
    await runUserSecurityMutation(user.id, async () => {
      const activeUser = await getRepository(User).findOne({
        where: { id: user.id },
        select: { id: true, plexToken: true },
      });
      if (!activeUser?.plexToken) {
        logger.warn('Skipping user refresh token for user without plex token', {
          label: 'Plex Refresh Token',
          userId: user.id,
        });
        return;
      }

      await new PlexTvAPI(activeUser.plexToken).pingToken();
    });
  }
}

const refreshToken = new RefreshToken();

export default refreshToken;
