/**
 * The media object kinds OLOS can issue upload slots for: `init` (CMAF
 * initialization segment), `part` (LL-HLS partial segment), and `segment`
 * (full segment). `MediaObjectKind` (olos/types) is the derived union type.
 */
export const MEDIA_OBJECT_KINDS = ["init", "part", "segment"] as const;
