/** Specification area an assertion belongs to (core, hls, object, ...). */
export type OlosConformanceLevel =
  | "core"
  | "hls"
  | "object"
  | "runtime"
  | "security";

/** Whether an assertion is fully (`covered`) or partially covered. */
export type OlosConformanceCoverageStatus = "covered" | "partial";
