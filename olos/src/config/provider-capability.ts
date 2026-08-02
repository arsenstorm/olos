/**
 * Provider categories a capability document may declare. Currently only
 * `object-store`; `ProviderKind` (olos/types) is the derived union type.
 */
export const PROVIDER_KINDS = ["object-store"] as const;

/**
 * Read-your-writes consistency levels a provider can declare for reads,
 * HEADs, and LISTs after object creation. `ProviderConsistencyLevel`
 * (olos/types) is the derived union type.
 */
export const PROVIDER_CONSISTENCY_LEVELS = [
  "strong",
  "eventual",
  "unknown",
] as const;

/**
 * Delivery guarantees a provider can declare for its object-created event
 * feed, from `none` (no events) to `exactly-once`.
 * `ProviderEventDeliveryMode` (olos/types) is the derived union type.
 */
export const PROVIDER_EVENT_DELIVERY_MODES = [
  "none",
  "best-effort",
  "at-least-once",
  "exactly-once",
] as const;
