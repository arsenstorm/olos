import type {
  PROVIDER_CONSISTENCY_LEVELS,
  PROVIDER_EVENT_DELIVERY_MODES,
  PROVIDER_KINDS,
} from "../config/provider-capability";
import type { OlosId } from "./ids";

export type ProviderConsistencyLevel =
  (typeof PROVIDER_CONSISTENCY_LEVELS)[number];
export type ProviderEventDeliveryMode =
  (typeof PROVIDER_EVENT_DELIVERY_MODES)[number];
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ProviderApiCapabilities {
  family: string;
}

export interface ProviderConsistencyCapabilities {
  headAfterCreate: ProviderConsistencyLevel;
  listAfterCreate?: ProviderConsistencyLevel;
  readAfterCreate: ProviderConsistencyLevel;
}

export interface ProviderPublicationCapabilities {
  createIfAbsent: boolean;
  directObjectPublication: boolean;
  manifestGatedPublication?: boolean;
  overwritesAllowed?: boolean;
  privateUploadPublicPromotion?: boolean;
  readGateAvailable?: boolean;
}

export interface ProviderUploadGrantCapabilities {
  contentTypeBound?: boolean;
  exactKey?: boolean;
  maxRecommendedTtlSeconds?: number;
  methodBound?: boolean;
  presignedPut?: boolean;
  requiredHeadersCanBeSigned?: boolean;
  temporaryCredentials?: boolean;
}

export interface ProviderDeliveryCapabilities {
  documentNavigationCanBeBlocked?: boolean;
  immutableCaching?: boolean;
  negativeCachingPolicyDeclared: boolean;
  publicBaseUrl: string;
  rangeRequests?: boolean;
}

export interface ProviderEventCapabilities {
  delivery?: ProviderEventDeliveryMode;
  objectCreated?: boolean;
}

export interface ProviderCapabilityDocument {
  api?: ProviderApiCapabilities;
  consistency: ProviderConsistencyCapabilities;
  delivery: ProviderDeliveryCapabilities;
  events?: ProviderEventCapabilities;
  kind: ProviderKind;
  olos: "1.0";
  providerId: OlosId;
  publication: ProviderPublicationCapabilities;
  uploadGrants: ProviderUploadGrantCapabilities;
}
