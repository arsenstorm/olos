/**
 * Byte-range LL-HLS support.
 *
 * Parts may either be standalone objects (each with its own `objectKey` and
 * `deliveryUrl`) or byte ranges within a logical "virtual segment". When a
 * part declares a `Byterange`, the manifest renderer emits
 * `#EXT-X-PART:BYTERANGE="<length>@<offset>",URI="<segmentDeliveryUrl>"`
 * instead of pointing at the part's own URI, and a
 * `#EXT-X-PRELOAD-HINT:TYPE=PART` line is added for the next byte range so
 * players can hold a Range request open against the segment URL.
 *
 * `byterange.offset` is the part's first byte within the virtual segment,
 * `byterange.length` is its byte count. `segmentObjectKey` /
 * `segmentDeliveryUrl` identify the virtual segment the part contributes
 * to; the segment itself is synthesised on demand from its part objects.
 */
export interface Byterange {
  length: number;
  offset: number;
  segmentDeliveryUrl: string;
  segmentObjectKey: string;
}
