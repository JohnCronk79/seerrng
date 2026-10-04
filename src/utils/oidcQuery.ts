export function hasOidcCallbackParameters(
  query: Record<string, unknown>
): boolean {
  return query.code != null || query.error != null;
}
