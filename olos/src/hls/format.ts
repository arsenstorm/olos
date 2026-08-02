const QUOTED_STRING_FORBIDDEN = /["\r\n]/;

/**
 * Validates a value destined for an RFC 8216 §4.2 quoted-string attribute
 * and returns it verbatim. Quoted-strings have no escape mechanism, so
 * double quotes and line breaks cannot be represented — the function throws
 * (naming the offending `name`) instead of emitting a value that would
 * corrupt the playlist.
 */
export function quotedPlaylistValue(value: string, name: string): string {
  if (QUOTED_STRING_FORBIDDEN.test(value)) {
    throw new Error(`${name} must not contain double quotes or line breaks`);
  }

  return value;
}

export function formatSeconds(value: number): string {
  return value.toFixed(3);
}

export function formatFrameRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
