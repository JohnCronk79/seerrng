# Security dependency follow-up — 2026-10-07

The patched runtime and documentation dependency advisories found on `main`
are updated in their lockfiles. A separate `pnpm audit` against the package
registry reports two newer advisories without a verified upstream fix:

- `braces@3.0.3` (`GHSA-vfj7-8cjw-p6xm`) is reachable only through the root
  Next ESLint plugin and the documentation glob tooling. Both are development
  or build dependencies. No patched upstream release is published. Do not pin
  an unpublished version or substitute an unreviewed fork; check again for an
  upstream release.
- `http-cache-semantics@4.2.0` (`GHSA-ch52-4w7c-c8xp`) is reachable only
  through the documentation generator's update-checking dependencies. The
  registry lists `4.3.0`, but that release contains no change to the affected
  cache-reuse logic, so it is not treated as a security fix. Check again for a
  verified fix before upgrading this dependency.

`pnpm audit --prod --audit-level low` passes for the SeerrNG application. The
full root and documentation audits continue to report the unpatched
development/build-tool advisories; audit checks were not disabled or ignored.
