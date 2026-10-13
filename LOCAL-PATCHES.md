# Maintained local patch

Base: upstream pi-session-search v1.6.0, commit 5a910e7c3a238d347e90020147815227b567b85e, MIT. Original LICENSE and attribution retained. This checkout is the public source of the published npm package `@leo_aifirst/pi-session-search`; it is not an edit to the npm installation.

- Correlate successful direct results with tool-call arguments; extract successful codemode nested file operations. Failed/pending calls do not count as completed writes.
- Include assistant text, CWD/ID and read/modified file paths in newly indexed FTS records.
- session_search(mode="literal") decodes configured session roots without depending on index freshness or embeddings. It searches message text, metadata and path arguments; it does not export raw logs or search generated write content.
- Existing indexed API remains the default. Existing persisted rows are not silently rebuilt; use literal mode immediately, or /session-reindex to refresh all rows. Hybrid re-index may incur embedding cost and requires separate authorization.

Verification: npm run build; npm run check; npm test. The artifact-search regression uses an empty index, Chinese/spaced path, successful nested write, failed nested edit, project rejection and no write-content search, across a real worker thread.

## Distribution

- Public source: https://github.com/zenenznze/pi-session-search.git (remote `github`; npm provenance).
- npm: `@leo_aifirst/pi-session-search`, scope `leo_aifirst`, published public from the exact tested tarball.
- Private maintained mirror: `ssh://gitea/joe/pi-session-search.git` (remote `gitea`; local `main` tracks `gitea/main`).
- The GitHub `origin` remote is upstream provenance (`samfoy/pi-session-search`), not a delivery destination.
- Upstream history, LICENSE and attribution are preserved. Publishing a fork does not imply an upstream push; an upstream pull request for these patches is a separate, optional step.

Use the published package as a Pi package: install the exact npm version, preserve other package declarations, enable exactly one session-search package, and run a resource-load check. Reload/new sessions are needed for runtime changes; current sessions can retain the previous tool schema.
