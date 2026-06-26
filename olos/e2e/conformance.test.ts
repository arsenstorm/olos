import { readFileSync } from "node:fs";
import {
  renderMasterPlaylist,
  renderMediaPlaylist,
} from "@arsenstorm/olos/hls";
import { createRuntimeObjectLowLatencyManifestOptions } from "@arsenstorm/olos/runtime";
import { assertCommittedWindow } from "@arsenstorm/olos/validation";
import { describe, expect, test } from "vitest";

import {
  conformanceCommittedWindow,
  conformanceSession,
} from "./conformance-fixtures";

const goldenMediaPlaylist = readFixture("media-playlist.m3u8");
const goldenMasterPlaylist = readFixture("master-playlist.m3u8");
const manifestOptions = createRuntimeObjectLowLatencyManifestOptions();

describe("conformance", () => {
  test("CORE-WINDOW-002 renders EXT-X-MAP from committed init object", () => {
    assertCommittedWindow(conformanceCommittedWindow);

    expect(
      renderMediaPlaylist(conformanceCommittedWindow, mediaPlaylistOptions())
    ).toContain("#EXT-X-MAP:");
  });

  test("HLS-GOLDEN-001 renders stable master playlist output", () => {
    expect(renderMasterPlaylist(conformanceSession)).toBe(goldenMasterPlaylist);
  });

  test("HLS-GOLDEN-002 renders stable LL-HLS media playlist output", () => {
    expect(
      renderMediaPlaylist(conformanceCommittedWindow, mediaPlaylistOptions())
    ).toBe(goldenMediaPlaylist);
  });

  test("HLS-GOLDEN-007 omits preload hints by default", () => {
    expect(
      renderMediaPlaylist(conformanceCommittedWindow, mediaPlaylistOptions())
    ).not.toContain("#EXT-X-PRELOAD-HINT");
  });

  test("HLS-GOLDEN-008 rejects unapproved absolute media URI authorities", () => {
    expect(() =>
      renderMediaPlaylist(
        {
          ...conformanceCommittedWindow,
          renditions: {
            v1080: {
              ...conformanceCommittedWindow.renditions.v1080,
              init: {
                ...conformanceCommittedWindow.renditions.v1080.init,
                deliveryUrl: "https://publisher.example.net/injected.mp4",
              },
            },
          },
        },
        mediaPlaylistOptions()
      )
    ).toThrow("rendition.init.deliveryUrl origin is not allowed");
  });
});

function mediaPlaylistOptions() {
  return {
    allowedMediaOrigins: ["https://media.example.com"],
    ...manifestOptions.manifest,
    renditionId: "v1080",
  };
}

function readFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/golden/${name}`, import.meta.url), {
    encoding: "utf8",
  });
}
