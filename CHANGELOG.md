# Changelog

Notable package changes are documented here.

This project follows semantic versioning for the published `olos` package.

## Unreleased

- No unreleased changes.

## 0.1.0

- Added core OLOS protocol types, validation, and coordinator state helpers.
- Added stored runtime helpers for sessions, upload slots, commits, manifests,
  retention, publisher liveness, and publisher upload loops.
- Added configurable late upload tolerance for runtime and S3 commit paths.
- Added publication controls and app-owned commit policy hooks for runtime,
  S3, provider-event, and recovery commit paths.
- Added HLS and LL-HLS manifest generation with blocking reload support.
- Added S3-compatible upload grants, object observation, event routing,
  reconciliation, and retention helpers.
- Added S3-native slot metadata binding and observation normalization.
- Added in-memory and SQLite-backed serialized coordinator store adapters.
- Added conformance coverage metadata and package publication checks.
