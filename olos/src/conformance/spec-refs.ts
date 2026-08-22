import {
  OLOS_CONFORMANCE_COVERAGE_ROWS,
  type OlosConformanceAssertionId,
} from "./coverage-rows";

/**
 * Spec section that claims each conformance assertion id, mirroring the
 * `<!-- olos-conformance: <section> <id> ... -->` anchors in `spec/*.md`.
 * A `null` value means the assertion is not yet referenced by a spec
 * section. `scripts/check-spec-refs.ts` keeps this table in lockstep with
 * the anchors.
 */
export const OLOS_CONFORMANCE_SPEC_REFS = Object.fromEntries(
  OLOS_CONFORMANCE_COVERAGE_ROWS.map((row) => [row[0], row[3]])
) as Record<OlosConformanceAssertionId, string | null>;
