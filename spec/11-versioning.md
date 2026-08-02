# 11. Versioning and compatibility

## 11.1 Wire version vs specification status

Two version identifiers exist. They MUST NOT be conflated:

- **`OLOS_WIRE_VERSION` = `"1.0"`** is the wire compatibility
  contract. It appears as the `olos` field, a fixed-value constant, in
  the wire schemas that carry it ("OLOS Session", "OLOS Cursor", and
  "OLOS ProviderCapabilityDocument", Appendix A). If a document's
  `olos` field is not `"1.0"`, 1.0 validators MUST reject it.
- **`OLOS_SPEC_STATUS`** (currently `draft-v1.0.0`) is the revision of
  this specification document set. It is informational and never
  appears on the wire. It changes with every published spec revision,
  including editorial ones.

The wire version changes **only** on breaking wire changes. A breaking
wire change is one that can make a previously valid exchange invalid
or reinterpret it, including:

- a deleted field, an optional field that becomes required, or a
  narrowed set of accepted values in a request or stored document.
- a changed meaning, changed units, or changed ordering guarantees of
  an existing field (for example, cursor or committed-window
  semantics, Section 5).
- a deleted or renamed route, a changed route method, or an
  incompatible change to a success status or response shape.
- a change to object-key derivation (Section 7.5) after which existing
  keys resolve differently.

## 11.2 Additive changes

The following changes are additive and MUST NOT change the wire
version:

- new OPTIONAL request fields, new response fields, and new routes.
- new registered error codes (Section 11.3).
- new provider capability fields and new session/rendition OPTIONAL
  fields.
- new playlist tags or attributes that RFC 8216 requires clients to
  ignore.

Servers MUST NOT require fields that this specification marks
OPTIONAL. Clients MUST ignore unknown fields in responses and stored
documents. Schema validation of *incoming* payloads MAY remain strict
on the server side. For this reason, a new **request** field is
additive, but removal of tolerance for one is breaking.

## 11.3 Error-code registry growth

The error-code registry (Section 6.3.1) grows additively:

- A new code is a non-breaking change and does not touch the wire
  version.
- A deleted or renamed registered code, or a changed status mapping
  for an existing code (Section 6.3.2), is breaking.
- Consumers MUST tolerate unknown `error.code` values. An
  unrecognized code MUST be handled by its HTTP status class, not
  treated as a malformed response. Registered-but-unemitted codes
  (`olos.slot_expired`, `olos.provider_unavailable`, Section 6.3.1)
  exist so that implementations can start to emit them without a
  version bump.

## 11.4 Revision policy

- Spec revisions that only clarify prose or add examples bump only
  `OLOS_SPEC_STATUS`.
- Spec revisions that add wire surface (Section 11.2) bump
  `OLOS_SPEC_STATUS` and leave `OLOS_WIRE_VERSION` at `1.0`.
- Breaking wire changes require a new wire version. Validators for
  the new version reject old documents by the `olos` const.
  Coordinators MAY serve both versions side by side during migration.

Implementations SHOULD surface both identifiers in diagnostics. An
interoperability report can then name the exact contract under test.
