// RFC 6381 codec strings derived from the fMP4 init segment ffmpeg produces.
//
// Hardcoding the codec string is not viable here: the streamer passes the
// encoder's bitstream through with `-c:v copy -c:a copy`, so the profile,
// level, and track layout are whatever OBS negotiated. hls.js probes the
// media and plays regardless of what CODECS claims, but Safari's native HLS
// player trusts CODECS — an omitted audio codec makes it build a video-only
// pipeline and fail on segments that carry an audio track.

const AVC_CONFIG_BOX = "avcC";
const AUDIO_SAMPLE_ENTRY_BOX = "mp4a";
const VIDEO_SAMPLE_ENTRY_BOX = "avc1";

// AAC-LC. ffmpeg's `aac` encoder and OBS both produce it, and the streamer
// copies the bitstream rather than re-encoding, so the object type is not
// read back out of the `esds` descriptor.
const AAC_LC_CODEC = "mp4a.40.2";

// VisualSampleEntry: 6 reserved + 2 data_reference_index + 2 pre_defined +
// 2 reserved + 12 pre_defined, then 16-bit width and height.
const SAMPLE_ENTRY_DIMENSIONS_OFFSET = 24;

export interface InitCodecs {
  audioCodec?: string;
  height?: number;
  videoCodec?: string;
  width?: number;
}

export function parseInitCodecs(bytes: Uint8Array): InitCodecs {
  const videoCodec = parseAvcCodec(bytes);
  const dimensions = parseVideoDimensions(bytes);

  return {
    audioCodec:
      findBox(bytes, AUDIO_SAMPLE_ENTRY_BOX) === undefined
        ? undefined
        : AAC_LC_CODEC,
    height: dimensions?.height,
    videoCodec,
    width: dimensions?.width,
  };
}

function parseAvcCodec(bytes: Uint8Array): string | undefined {
  const start = findBox(bytes, AVC_CONFIG_BOX);
  if (start === undefined || start + 4 > bytes.length) {
    return;
  }

  // AVCDecoderConfigurationRecord: configurationVersion, AVCProfileIndication,
  // profile_compatibility, AVCLevelIndication.
  const profile = bytes[start + 1];
  const compatibility = bytes[start + 2];
  const level = bytes[start + 3];

  return `avc1.${hexByte(profile)}${hexByte(compatibility)}${hexByte(level)}`;
}

function parseVideoDimensions(
  bytes: Uint8Array
): { height: number; width: number } | undefined {
  const start = findBox(bytes, VIDEO_SAMPLE_ENTRY_BOX);
  if (start === undefined) {
    return;
  }

  const offset = start + SAMPLE_ENTRY_DIMENSIONS_OFFSET;
  if (offset + 4 > bytes.length) {
    return;
  }

  // Read through a DataView rather than composing the big-endian pair by
  // hand. `bytes` is often a Buffer, which is a view into a pooled
  // ArrayBuffer, so the view must carry the byte offset and length.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(offset);
  const height = view.getUint16(offset + 2);

  return width > 0 && height > 0 ? { height, width } : undefined;
}

// Returns the offset just past the four-character box type. The init segment
// is a few kilobytes, so a linear scan for the tag is cheaper than walking
// the box tree and is not confused by it: these tags do not occur as payload
// in a well-formed init segment.
function findBox(bytes: Uint8Array, type: string): number | undefined {
  const tag = [
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ];

  for (let index = 0; index + 4 <= bytes.length; index += 1) {
    if (matchesTagAt(bytes, index, tag)) {
      return index + 4;
    }
  }
}

function matchesTagAt(
  bytes: Uint8Array,
  index: number,
  tag: readonly number[]
): boolean {
  return tag.every((byte, offset) => bytes[index + offset] === byte);
}

function hexByte(value: number | undefined): string {
  return (value ?? 0).toString(16).padStart(2, "0");
}
