# Conformance Progress

The source of truth for executable conformance coverage is
`olos/src/conformance.ts`.

Current manifest snapshot:

| Level | Covered assertions |
| --- | ---: |
| Core | 38 |
| Runtime | 24 |
| Object | 41 |
| HLS | 17 |
| Security | 7 |
| Total | 127 |

The Core bucket holds the protocol-essential assertions: slot issuance, slot
expiry, object/slot mismatch rejection, size rejection, duplicate-commit
idempotency, late-commit rejection, cursor monotonicity, and `CommittedWindow`
ordering. The Runtime bucket holds heartbeats, health, retention,
reconciliation, and session lifecycle — the operational glue that lives in
the runtime layer, not in the protocol-essential commit semantics.

Coverage means an assertion ID is mapped to a deterministic test file in
`OLOS_CONFORMANCE_COVERAGE`. It does not mean a deployment is production-ready;
applications still need their own authentication, storage policy, monitoring,
and provider-specific integration tests.

Generate the current CI-friendly report with:

```bash
bun --filter '@arsenstorm/olos' conformance:report
```

Check that every known assertion is mapped before release work with:

```bash
bun --filter '@arsenstorm/olos' conformance:check
```

The validation workflow uploads this report as `olos-conformance`.

When adding or changing behavior:

1. Add or update the relevant assertion ID in `OLOS_CONFORMANCE_ASSERTION_IDS`.
2. Add deterministic coverage in the smallest useful test file.
3. Add the test mapping to `OLOS_CONFORMANCE_COVERAGE`.
4. Run `bun run publish:check` before publishing or release work.

Use `olos/src/conformance/metadata.ts` for the assertion catalogue and
interoperability target.
