export function escapePlaylistValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function formatSeconds(value: number): string {
  return value.toFixed(3);
}

export function formatFrameRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
