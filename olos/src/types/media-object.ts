import type { MEDIA_OBJECT_KINDS } from "../config/media-object";

export type MediaObjectKind = (typeof MEDIA_OBJECT_KINDS)[number];

export interface MediaObject {
  contentType: string;
  etag?: string;
  objectKey: string;
  observedAt: string;
  providerId: string;
  size: number;
}
