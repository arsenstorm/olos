# 11. Versioning and compatibility

## 11.1 Wire version vs specification status

Two version identifiers exist and MUST NOT be conflated:

- **`OLOS_WIRE_VERSION` = `"1.0"`** — the wire compatibility
  contract. It appears as the `olos` field, a fixed-value constant, in
  the wire schemas that carry it ("OLOS Session", "OLOS Cursor", and
  "OLOS ProviderCapabilityDocument", Appendix A). A document whose
  `olos` field is not `"1.0"` MUST be rejected by 1.0 validators.
- **`OLOS_SPEC_STATUS`** (currently `draft-v1.0.0`) — the revision of
  this specification document set. It is informational, never appears
  on the wire, and changes with every published spec revision,
  including editorial ones.

The wire version changes **only** on breaking wire changes. A breaking
wire change is one that can make a previously valid exchange invalid
or reinterpret it, including:

- removing a field, making an optional field required, or narrowing a
  field's accepted values in a request or stored document;
- changing the meaning, units, or ordering guarantees of an existing
  field (e.g. cursor or committed-window semantics, Section 5);
- removing or renaming a route, changing a route's method, or
  changing a success status or response shape incompatibly;
- changing object-key derivation (Section 7.5) such that existing
  keys resolve differently.

## 11.2 Additive changes

The following are additive and MUST NOT change the wire version:

- new OPTIONAL request fields, new response fields, and new routes;
- new registered error codes (Section 11.3);
- new provider capability fields and new session/rendition OPTIONAL
  fields;
- new playlist tags or attributes that RFC 8216 clients are required
  to ignore.

Servers MUST NOT require fields this specification marks OPTIONAL.
Clients MUST ignore unknown fields in responses and stored documents;
schema validation of *incoming* payloads MAY remain strict on the
server side, which is why adding a **request** field is additive but
removing tolerance for one is breaking.

## 11.3 Error-code registry growth

The error-code registry (Section 6.3.1) grows additively:

- Adding a code is a non-breaking change and does not touch the wire
  version.
- Removing or renaming a registered code, or changing the status
  mapping of an existing code (Section 6.3.2), is breaking.
- Consumers MUST tolerate unknown `error.code` values: an
  unrecognized code MUST be handled by its HTTP status class, not
  treated as a malformed response. Registered-but-unemitted codes
  (`olos.slot_expired`, `olos.provider_unavailable`, Section 6.3.1)
  exist precisely so implementations can begin emitting them without
  a version bump.

## 11.4 Revision policy

- Spec revisions that only clarify prose or add examples bump
  `OLOS_SPEC_STATUS` only.
- Spec revisions that add wire surface (Section 11.2) bump
  `OLOS_SPEC_STATUS` and leave `OLOS_WIRE_VERSION` at `1.0`.
- Breaking wire changes require a new wire version; validators for
  the new version reject old documents by the `olos` const, and
  coordinators MAY serve both versions side by side during migration.

Implementations SHOULD surface both identifiers in diagnostics so an
interoperability report can name the exact contract being tested.
