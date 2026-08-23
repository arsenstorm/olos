import type { CommittedWindow, TrackWindow } from "../types/committed-window";

/** The track window a fixture is expected to carry; fails the test otherwise. */
export function trackWindow(
  window: CommittedWindow,
  trackId: string
): TrackWindow {
  const track = window.tracks[trackId];

  if (track === undefined) {
    throw new Error(`missing ${trackId} track window fixture`);
  }

  return track;
}
