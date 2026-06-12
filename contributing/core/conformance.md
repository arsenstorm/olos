# Conformance Progress

The source of truth for executable conformance coverage is
`olos/src/conformance.ts`.

Current manifest snapshot:

| Level | Covered assertions |
| --- | ---: |
| Core | 52 |
| Object | 29 |
| HLS | 10 |
| Security | 7 |
| Total | 98 |

Coverage means an assertion ID is mapped to a deterministic test file in
`OLOS_CONFORMANCE_COVERAGE`. It does not mean a deployment is production-ready;
applications still need their own authentication, storage policy, monitoring,
and provider-specific integration tests.

When adding or changing behavior:

1. Add or update the relevant assertion ID in `OLOS_CONFORMANCE_ASSERTION_IDS`.
2. Add deterministic coverage in the smallest useful test file.
3. Add the test mapping to `OLOS_CONFORMANCE_COVERAGE`.
4. Run `bun run publish:check` before publishing or release work.

Use `specs/08-conformance.md` for the assertion catalogue and interoperability
target.
