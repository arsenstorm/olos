# Pull request descriptions

A good pull request description makes review faster and preserves the reason for
the change after the diff is merged.

## Use the template

`.github/PULL_REQUEST_TEMPLATE.md` auto-populates new pull requests with a
Summary / Why / Test plan / Notes structure. Do not delete the headings. If a
section truly does not apply, write `n/a` and a one-line reason.

Pull requests targeting `main` should pass the required
`Validate / Validate` status check before merge. See
[repository checks](./checks.md) for the full expected protection policy.

## Summary

Describe what changed at a behavioural level. Prefer the protocol, package, or
developer-facing effect over a file-by-file diff.

Good:

```text
Adds a committed-window validation helper that rejects non-monotonic media
sequence numbers before HLS rendering.
```

Avoid:

```text
Changed src/core/window.ts and updated a test file.
```

## Why

Explain the motivation. Link related GitHub issues with `Closes #NN` or
`Related: #NN` when applicable.

## Test plan

List what you actually ran and what remains untested. Include focused commands
for the package or area that changed.

Common commands:

```bash
bun run check
bun run check-types
bun run test
bun run build
```

## Notes

Use Notes for rollout order, follow-ups, API compatibility concerns, generated
fixture updates, or anything else a reviewer should know.

For public-facing cleanup, state the compatibility intent explicitly:

- Write `Public behavior unchanged` when the change preserves public APIs, wire
  formats, package exports, conformance assertion IDs, security behavior, and
  README examples.
- If public behavior changes, describe the compatibility impact and link the
  matching README, changelog, release-note, or migration update.

## Title format

Use:

```text
<type>: <imperative summary>
```

Where `<type>` is one of `feat`, `fix`, `refactor`, `chore`, `docs`, or `test`.
Keep titles short enough to become useful squash-commit messages.
