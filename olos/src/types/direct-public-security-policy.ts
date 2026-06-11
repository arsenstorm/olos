import type { DeliveryCachePolicy } from "./cache-policy";

export interface DirectPublicSecurityPolicy {
  allowedMediaOrigins: readonly string[];
  manifestCachePolicy: DeliveryCachePolicy;
  mediaObjectCachePolicy: DeliveryCachePolicy;
  negativeObjectCachePolicy: DeliveryCachePolicy;
}
