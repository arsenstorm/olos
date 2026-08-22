import {
  type CreateDirectPublicSecurityPolicyOptions,
  createDirectPublicSecurityPolicy,
} from "../state/direct-public-security-policy";
import type { DirectPublicSecurityPolicy } from "../types/direct-public-security-policy";

/** Object extensions the CMAF/LL-HLS profile serves direct-public. */
export const MEDIA_DIRECT_PUBLIC_OBJECT_EXTENSIONS = [".m4s", ".mp4"] as const;
/** Content type of every CMAF object served direct-public. */
export const MEDIA_DIRECT_PUBLIC_OBJECT_CONTENT_TYPE = "video/mp4";

/** Options for {@link createDirectPublicMediaSecurityPolicy}. */
export type CreateDirectPublicMediaSecurityPolicyOptions = Omit<
  CreateDirectPublicSecurityPolicyOptions,
  "allowedObjectExtensions" | "objectContentType"
>;

/** `createDirectPublicSecurityPolicy` pinned to the CMAF/LL-HLS extensions and content type. */
export function createDirectPublicMediaSecurityPolicy(
  options: CreateDirectPublicMediaSecurityPolicyOptions
): DirectPublicSecurityPolicy {
  return createDirectPublicSecurityPolicy({
    ...options,
    allowedObjectExtensions: MEDIA_DIRECT_PUBLIC_OBJECT_EXTENSIONS,
    objectContentType: MEDIA_DIRECT_PUBLIC_OBJECT_CONTENT_TYPE,
  });
}
