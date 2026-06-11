import type { PATHWAY_STATES } from "../config/pathway";
import type { OlosId } from "./ids";

export type PathwayState = (typeof PATHWAY_STATES)[number];

export interface Pathway {
  baseUrl: string;
  pathwayId: OlosId;
  priority: number;
  providerId: OlosId;
  state: PathwayState;
}
