export type MediaObjectKind = "init" | "part" | "segment" | "sidecar";

export interface MediaObject {
  contentType: string;
  etag?: string;
  objectKey: string;
  observedAt: string;
  providerId: string;
  size: number;
}
