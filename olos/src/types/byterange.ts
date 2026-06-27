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
 * `byterange.length` is its byte count.
 *
 * Authority: `segmentObjectKey` and `segmentDeliveryUrl` are virtual
 * byterange identifiers used by the manifest renderer and the application's
 * virtual-segment serving route. They are NOT object-store publication
 * authority — no upload grant or commit is issued against them. The
 * publisher MUST set them so the part slots and the eventual segment slot
 * agree on the segment address; the convention is to derive them from a
 * shared per-segment `objectKeyNonce` using
 * `createPublisherObjectKey({ kind: "segment", mediaSequenceNumber,
 * objectKeyNonce, renditionId })`. Future revisions may move derivation
 * server-side; for now they are publisher-supplied.
 */
export interface Byterange {
  length: number;
  offset: number;
  segmentDeliveryUrl: string;
  segmentObjectKey: string;
}
