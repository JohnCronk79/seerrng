import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import gravatarUrl from 'gravatar-url';

export interface SeedDbOptions {
  /** If true, preserves existing data instead of dropping the database */
  preserveDb?: boolean;
  /** If true, runs migrations instead of synchronizing schema */
  withMigrations?: boolean;
  /** If true, permits seeding while NODE_ENV is not test */
  allowOutsideTest?: boolean;
}

// Precomputed bcrypt hash of 'test1234'. We precompute this to avoid
// having to hash the password every time we seed the database.
const TEST_USER_PASSWORD_HASH =
  '$2b$12$Z5V2P5HZgmx4/AnWFMZN1.aD5AM1NucNi.mhNTSQ9oVtmdzu7Le/a';

function assertTestDatabase(operation: string, allowOutsideTest = false): void {
  if (allowOutsideTest || process.env.NODE_ENV === 'test') {
    return;
  }

  throw new Error(
    `Refusing to ${operation} while NODE_ENV is not test: this drops every table and seeds accounts with a known password.`
  );
}

/**
 * Seeds test users into the database.
 * Assumes the database schema is already set up.
 */
export async function seedTestUsers(): Promise<void> {
  const userRepository = getRepository(User);

  const admin = await userRepository.findOne({
    select: { id: true, plexId: true },
    where: { id: 1 },
  });

  // Create the admin user
  const user =
    (await userRepository.findOne({
      where: { email: 'admin@seerr.dev' },
    })) ?? new User();
  user.plexId = admin?.plexId ?? 1;
  user.plexToken = '1234';
  user.plexUsername = 'admin';
  user.username = 'admin';
  user.email = 'admin@seerr.dev';
  user.userType = UserType.PLEX;
  user.password = TEST_USER_PASSWORD_HASH;
  user.permissions = 2;
  user.avatar = gravatarUrl('admin@seerr.dev', { default: 'mm', size: 200 });
  await userRepository.save(user);

  const friendUser =
    (await userRepository.findOne({
      where: { email: 'friend@seerr.dev' },
    })) ?? new User();
  friendUser.plexId = 2;
  friendUser.plexToken = '1234';
  friendUser.plexUsername = 'friend';
  friendUser.username = 'friend';
  friendUser.email = 'friend@seerr.dev';
  friendUser.userType = UserType.PLEX;
  friendUser.password = TEST_USER_PASSWORD_HASH;
  friendUser.permissions = 32;
  friendUser.avatar = gravatarUrl('friend@seerr.dev', {
    default: 'mm',
    size: 200,
  });
  await userRepository.save(friendUser);

  const demoUser =
    (await userRepository.findOne({
      where: { email: 'demo@seerr.dev' },
    })) ?? new User();
  demoUser.plexId = 3;
  demoUser.plexToken = '1234';
  demoUser.plexUsername = 'demo';
  demoUser.username = 'demo';
  demoUser.email = 'demo@seerr.dev';
  demoUser.userType = UserType.PLEX;
  demoUser.password = TEST_USER_PASSWORD_HASH;
  demoUser.permissions = 32;
  demoUser.avatar = gravatarUrl('demo@seerr.dev', {
    default: 'mm',
    size: 200,
  });
  await userRepository.save(demoUser);
}

/**
 * Initializes the database connection and seeds test users.
 * Used by both Cypress tests and Vitest unit tests.
 */
export async function seedTestDb(options: SeedDbOptions = {}): Promise<void> {
  assertTestDatabase('seed the test database', options.allowOutsideTest);

  const dbConnection = dataSource.isInitialized
    ? dataSource
    : await dataSource.initialize();

  if (!options.preserveDb) {
    await dbConnection.dropDatabase();
  }

  if (options.withMigrations) {
    await dbConnection.runMigrations();
  } else {
    await dbConnection.synchronize();
  }

  await seedTestUsers();
}

/**
 * Resets the database to a clean state with seeded test users.
 * Used between tests to ensure isolation.
 * Assumes DB has been initialized.
 */
export async function resetTestDb(): Promise<void> {
  assertTestDatabase('reset the test database');

  await dataSource.synchronize(true);
  await seedTestUsers();
}
