#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

status=0
mapfile -t source_files < <(find src -type f \( -name '*.ts' -o -name '*.tsx' \))

echo "Council browser-boundary check"

missing_rel="$(
  perl -0ne '
    while (/<[A-Za-z][A-Za-z0-9.]*\b[^>]*\btarget=["\x27]_blank["\x27][^>]*>/g) {
      my $tag = $&;
      next if $tag =~ /\brel=["\x27][^"\x27]*(?:noopener|noreferrer)[^"\x27]*["\x27]/;
      my $line = 1 + substr($_, 0, $-[0]) =~ tr/\n//;
      print "$ARGV:$line: $tag\n";
    }
  ' "${source_files[@]}" 2>/dev/null || true
)"

if [[ -n "$missing_rel" ]]; then
  status=1
  echo
  echo "target=\"_blank\" JSX elements need rel=\"noopener noreferrer\" or rel=\"noreferrer\":"
  echo "$missing_rel"
fi

unsafe_window_open="$(
  perl -0ne '
    while (/window\.open\s*\((.*?)(?<!\\)\)\s*;/sg) {
      my $call = $&;
      next unless $call =~ /["\x27]_blank["\x27]/;
      next if $call =~ /["\x27][^"\x27]*(?:noopener|noreferrer)[^"\x27]*["\x27]/;
      my $line = 1 + substr($_, 0, $-[0]) =~ tr/\n//;
      print "$ARGV:$line: $call\n";
    }
  ' "${source_files[@]}" 2>/dev/null || true
)"

if [[ -n "$unsafe_window_open" ]]; then
  status=1
  echo
  echo "window.open(..., '_blank') calls need noopener/noreferrer features:"
  echo "$unsafe_window_open"
fi

if [[ "$status" -eq 0 ]]; then
  echo "No unsafe _blank browser boundaries found."
fi

exit "$status"
