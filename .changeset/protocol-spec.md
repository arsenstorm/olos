---
"@arsenstorm/olos": minor
---

The OLOS protocol now has a full normative specification in the
repository's `spec/` directory. It has 11 sections plus generated
appendices, anchored to the conformance assertion set.
`OLOS_SPEC_STATUS` is now `draft-v1.0.0`. The new
`OLOS_CONFORMANCE_SPEC_REFS` export maps each conformance assertion ID to
the spec section that specifies it, or `null` when the assertion is not
yet referenced by a spec section (currently 101 of 133 are mapped).
