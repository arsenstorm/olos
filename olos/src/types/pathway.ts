import type { OlosId } from "./ids";

export type PathwayState = "active" | "degraded" | "draining" | "disabled";

export interface Pathway {
  baseUrl: string;
  pathwayId: OlosId;
  priority: number;
  providerId: OlosId;
  state: PathwayState;
}
