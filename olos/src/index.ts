/** Full protocol name: "Open Live Object Streaming". */
export const OLOS_PROTOCOL_NAME = "Open Live Object Streaming";
/** Protocol abbreviation: "OLOS". */
export const OLOS_PROTOCOL_SHORT_NAME = "OLOS";
/**
 * Revision of the OLOS specification this package implements. The
 * specification lives in the repository's `spec/` directory.
 */
export const OLOS_SPEC_STATUS = "draft-v1.0.0";
/**
 * Wire format version carried in the `olos` field of sessions, cursors, and
 * provider capability documents. Validators reject documents whose `olos`
 * field does not match this value.
 */
export const OLOS_WIRE_VERSION = "1.0";
