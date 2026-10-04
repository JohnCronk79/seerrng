#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

status=0
mapfile -t server_files < <(find server -type f -name '*.ts' ! -name '*.test.ts')

echo "Council server-boundary check"

unawaited_settings_save="$(
  perl -ne '
    next if /^\s*await\s+settings\.save\(\);/;
    next unless /^\s*settings\.save\(\);/;
    print "$ARGV:$.: $_";
  ' "${server_files[@]}" 2>/dev/null || true
)"

if [[ -n "$unawaited_settings_save" ]]; then
  status=1
  echo
  echo "settings.save() must be awaited before responding:"
  echo "$unawaited_settings_save"
fi

raw_settings_response="$(
  perl -0ne '
    while (/res\.(?:status\([^)]+\)\.)?json\(\s*settings\.(main|network|plex|jellyfin|tautulli|sonarr|radarr|readarr|lidarr|notifications)\s*\)/g) {
      my $line = 1 + substr($_, 0, $-[0]) =~ tr/\n//;
      print "$ARGV:$line: $&\n";
    }
  ' "${server_files[@]}" 2>/dev/null || true
)"

if [[ -n "$raw_settings_response" ]]; then
  status=1
  echo
  echo "Settings responses must redact secrets before returning JSON:"
  echo "$raw_settings_response"
fi

raw_user_response="$(
  perl -0ne '
    while (/res\.(?:status\([^)]+\)\.)?json\(\s*(?:user|users|updatedUsers|createdUsers|newUser|savedUser)\s*\)/g) {
      my $line = 1 + substr($_, 0, $-[0]) =~ tr/\n//;
      print "$ARGV:$line: $&\n";
    }
  ' server/routes/*.ts server/routes/**/*.ts 2>/dev/null || true
)"

if [[ -n "$raw_user_response" ]]; then
  status=1
  echo
  echo "User route responses must use User.filter/User.filterMany or an explicit DTO:"
  echo "$raw_user_response"
fi

raw_push_subscription_response="$(
  perl -0ne '
    while (/res\.(?:status\([^)]+\)\.)?json\(\s*(?:userPushSub|userPushSubs)\s*\)/g) {
      my $line = 1 + substr($_, 0, $-[0]) =~ tr/\n//;
      print "$ARGV:$line: $&\n";
    }
  ' server/routes/*.ts server/routes/**/*.ts 2>/dev/null || true
)"

if [[ -n "$raw_push_subscription_response" ]]; then
  status=1
  echo
  echo "Push subscription route responses must use explicit DTOs without auth keys:"
  echo "$raw_push_subscription_response"
fi

raw_entity_relation_response="$(
  perl -0ne '
    while (/res\.(?:status\([^)]+\)\.)?json\(\s*(?:request|requests|issue|issues|newIssue|comment|comments|media)\s*\)/g) {
      my $line = 1 + substr($_, 0, $-[0]) =~ tr/\n//;
      print "$ARGV:$line: $&\n";
    }
  ' server/routes/*.ts server/routes/**/*.ts 2>/dev/null || true
)"

if [[ -n "$raw_entity_relation_response" ]]; then
  status=1
  echo
  echo "Entity route responses with user relations must use filterEntityResponse or explicit DTOs:"
  echo "$raw_entity_relation_response"
fi

notification_url_posts="$(
  perl -0ne '
    next if /isSafeHttpUrl/;
    while (/axios\.post\(\s*(?:settings\.options\.(?:webhookUrl|url)|webhookUrl)/g) {
      my $line = 1 + substr($_, 0, $-[0]) =~ tr/\n//;
      print "$ARGV:$line: $&\n";
    }
  ' server/lib/notifications/agents/*.ts 2>/dev/null || true
)"

if [[ -n "$notification_url_posts" ]]; then
  status=1
  echo
  echo "Notification agents posting configurable URLs must validate with isSafeHttpUrl:"
  echo "$notification_url_posts"
fi

notification_route_url_validation="$(
  perl -0ne '
    next if /isSafeHttpUrl/;
    while (/validateNotificationUrl/g) {
      my $line = 1 + substr($_, 0, $-[0]) =~ tr/\n//;
      print "$ARGV:$line: $&\n";
    }
  ' server/routes/settings/notifications.ts 2>/dev/null || true
)"

if [[ -n "$notification_route_url_validation" ]]; then
  status=1
  echo
  echo "Notification settings URL validation must use isSafeHttpUrl:"
  echo "$notification_route_url_validation"
fi

if [[ "$status" -eq 0 ]]; then
  echo "No unsafe server boundary patterns found."
fi

exit "$status"
