import type {
  PROVIDER_CONSISTENCY_LEVELS,
  PROVIDER_EVENT_DELIVERY_MODES,
  PROVIDER_KINDS,
} from "../config/provider-capability";
import type { OlosId } from "./ids";

/** Read-your-writes consistency level: `strong`, `eventual`, or `unknown`. */
export type ProviderConsistencyLevel =
  (typeof PROVIDER_CONSISTENCY_LEVELS)[number];
/** Delivery guarantee of the provider's object-created event feed. */
export type ProviderEventDeliveryMode =
  (typeof PROVIDER_EVENT_DELIVERY_MODES)[number];
/** Provider category; currently only `object-store`. */
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Identifies the provider's API surface. */
export interface ProviderApiCapabilities {
  /** API family the provider speaks, e.g. `s3`. */
  family: string;
}

/** Consistency the provider guarantees for operations after object create. */
export interface ProviderConsistencyCapabilities {
  headAfterCreate: ProviderConsistencyLevel;
  listAfterCreate?: ProviderConsistencyLevel;
  readAfterCreate: ProviderConsistencyLevel;
}

/** Publication behaviors the provider supports. */
export interface ProviderPublicationCapabilities {
  /** Uploads can be restricted to create-if-absent (no overwrite races). */
  createIfAbsent: boolean;
  /** Uploaded objects can be served publicly without promotion or gating. */
  directObjectPublication: boolean;
  /** Objects stay unreachable until a manifest references them. */
  manifestGatedPublication?: boolean;
  /** Existing objects can be overwritten by uploads. */
  overwritesAllowed?: boolean;
  /** Private uploads can be promoted to a public location after commit. */
  privateUploadPublicPromotion?: boolean;
  /** Reads can be gated per request on commit state. */
  readGateAvailable?: boolean;
}

/** Constraints the provider can enforce on issued upload grants. */
export interface ProviderUploadGrantCapabilities {
  /** Grants bind the upload's Content-Type. */
  contentTypeBound: boolean;
  /** Grants bind the exact object key (no prefix-scoped uploads). */
  exactKey: boolean;
  /** Longest grant lifetime the provider recommends, in seconds. */
  maxRecommendedTtlSeconds?: number;
  /** Grants bind the HTTP method. */
  methodBound: boolean;
  /** The provider can report uploaded object sizes for verification. */
  objectSizeCanBeObserved: boolean;
  /** Presigned PUT URLs are available. */
  presignedPut?: boolean;
  /** Required headers can be covered by the grant's signature. */
  requiredHeadersCanBeSigned: boolean;
  /** Scoped temporary credentials are available. */
  temporaryCredentials?: boolean;
}

/** Delivery-path properties of the provider's public origin. */
export interface ProviderDeliveryCapabilities {
  /** Responses can forbid HTML document navigation (e.g. via CSP). */
  documentNavigationCanBeBlocked?: boolean;
  /** Immutable Cache-Control policies are honored end to end. */
  immutableCaching?: boolean;
  /** The provider declares how 404-class responses are cached. */
  negativeCachingPolicyDeclared: boolean;
  /** Public HTTP(S) base URL objects are served under. */
  publicBaseUrl: string;
  /** HTTP Range requests are supported on media objects. */
  rangeRequests?: boolean;
}

/** Object event feeds the provider offers. */
export interface ProviderEventCapabilities {
  delivery?: ProviderEventDeliveryMode;
  /** Object-created events are emitted. */
  objectCreated?: boolean;
}

/**
 * Self-description of an object-store provider: which OLOS publication
 * modes, grant constraints, and delivery guarantees it supports. Validated
 * by `assertProviderCapabilityDocument` (olos/validation); declaring
 * `directObjectPublication` requires strong `headAfterCreate` consistency,
 * manifest-gated publication, and a declared negative-caching policy.
 */
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
