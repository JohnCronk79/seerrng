const MAX_DISCORD_SNOWFLAKE = 18_446_744_073_709_551_615n;

export const normalizeDiscordSnowflake = (
  value: unknown
): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!/^[1-9]\d{0,19}$/.test(normalized)) {
    return undefined;
  }

  return BigInt(normalized) <= MAX_DISCORD_SNOWFLAKE ? normalized : undefined;
};
