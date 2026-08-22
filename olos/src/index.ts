/** Full protocol name: "Open Live Object Streaming". */
export const OLOS_PROTOCOL_NAME = "Open Live Object Streaming";
/** Protocol abbreviation: "OLOS". */
export const OLOS_PROTOCOL_SHORT_NAME = "OLOS";
/**
 * Revision of the OLOS specification this package implements. The
 * specification lives in the repository's `spec/` directory.
 */
export const OLOS_SPEC_STATUS = "draft-v1.0.0";
// biome-ignore lint/performance/noBarrelFile: OLOS_WIRE_VERSION is defined in types/session.ts, re-exported here for its historical home
export { OLOS_WIRE_VERSION } from "./types/session";
