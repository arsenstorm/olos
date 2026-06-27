import { describe, expect, test } from "bun:test";
import type {
  GetObjectCommandInput,
  GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { CoordinatorPipelineSnapshot } from "../protocol";
import { createMemoryCoordinatorStore } from "../protocol";
import type {
  CommittedPart,
  CommittedSegment,
} from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import {
  createByterangeSegmentResponse,
  type S3GetObjectClient,
} from "./byterange-response";

const SESSION_ID = "session_byterange_test";
const SEGMENT_OBJECT_KEY = "live/session/v1080/segment-0.m4s";
const SEGMENT_DELIVERY_URL =
  "https://media.example.com/live/session/v1080/segment-0.m4s";
const RANGE_PATTERN = /^bytes=(\d+)-(\d+)$/;

function makePart(
  index: number,
  offset: number,
  length: number
): CommittedPart {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = (offset + i) % 256;
  }
  return {
    byterange: {
      length,
      offset,
      segmentDeliveryUrl: SEGMENT_DELIVERY_URL,
      segmentObjectKey: SEGMENT_OBJECT_KEY,
    },
    commitId: `commit_${index}`,
    deliveryUrl: `https://media.example.com/live/session/v1080/part-${index}.m4s`,
    duration: 0.5,
    independent: true,
    objectKey: `live/session/v1080/part-${index}.m4s`,
    partNumber: index,
    slotId: `slot_${index}`,
  };
}

function makeCursor(parts: readonly CommittedPart[]): Cursor {
  const segment: CommittedSegment = {
    duration: 2,
    mediaSequenceNumber: 0,
    parts: [...parts],
  };
  return {
    committedWindow: {
      discontinuitySequence: 0,
      epoch: 1,
      firstMediaSequenceNumber: 0,
      lastMediaSequenceNumber: 0,
      renditions: {
        v1080: {
          init: {
            commitId: "commit_init",
            deliveryUrl:
              "https://media.example.com/live/session/v1080/init.mp4",
            objectKey: "live/session/v1080/init.mp4",
            slotId: "slot_init",
          },
          renditionId: "v1080",
          segments: [segment],
        },
      },
    },
    epoch: 1,
    latencyProfile: "object-ll",
    olos: "1.0",
    mediaBaseUrl: "https://media.example.com",
    partTarget: 0.5,
    segmentTarget: 2,
    sessionId: SESSION_ID,
    state: "live",
    updatedAt: "2026-06-26T00:00:00.000Z",
    window: {
      firstMediaSequenceNumber: 0,
      lastMediaSequenceNumber: 0,
      lastPartNumber: parts.at(-1)?.partNumber,
    },
  };
}

interface FakeS3 extends S3GetObjectClient {
  inputs: GetObjectCommandInput[];
}

function createFakeS3(parts: readonly CommittedPart[]): FakeS3 {
  const partsByKey = new Map(parts.map((part) => [part.objectKey, part]));
  const inputs: GetObjectCommandInput[] = [];

  return {
    inputs,
    send(command) {
      if (!(command instanceof GetObjectCommand)) {
        throw new Error("expected GetObjectCommand");
      }
      const input = command.input;
      inputs.push(input);
      const part = partsByKey.get(input.Key ?? "");
      if (part?.byterange === undefined) {
        return Promise.reject(new Error(`unknown part: ${input.Key}`));
      }

      const partBytes = new Uint8Array(part.byterange.length);
      for (let i = 0; i < partBytes.length; i += 1) {
        partBytes[i] = (part.byterange.offset + i) % 256;
      }

      const rangeMatch = input.Range?.match(RANGE_PATTERN);
      const slice =
        rangeMatch === null || rangeMatch === undefined
          ? partBytes
          : partBytes.slice(Number(rangeMatch[1]), Number(rangeMatch[2]) + 1);

      const body = {
        transformToWebStream(): ReadableStream<Uint8Array> {
          return new ReadableStream({
            start(controller) {
              controller.enqueue(slice);
              controller.close();
            },
          });
        },
      };

      const output = {
        Body: body,
        ContentLength: slice.length,
      } as unknown as GetObjectCommandOutput;
      return Promise.resolve(output);
    },
  };
}

async function seedStore(
  parts: readonly CommittedPart[]
): Promise<ReturnType<typeof createMemoryCoordinatorStore>> {
  const store = createMemoryCoordinatorStore();
  const snapshot: CoordinatorPipelineSnapshot = {
    etag: "1",
    state: {
      commits: [],
      cursor: makeCursor(parts),
      initCommits: [],
      mediaBaseUrl: "https://media.example.com",
      publisherLeases: [],
      session: {
        createdAt: "2026-06-26T00:00:00.000Z",
        epoch: 1,
        latencyProfile: "object-ll",
        olos: "1.0",
        partTarget: 0.5,
        renditions: [
          {
            bitrate: 5_000_000,
            codec: "avc1.640028",
            frameRate: 30,
            height: 1080,
            kind: "video",
            renditionId: "v1080",
            width: 1920,
          },
        ],
        segmentTarget: 2,
        sessionId: SESSION_ID,
        state: "live",
      },
      slots: [],
    },
  };
  const save = await store.save({
    sessionId: SESSION_ID,
    state: snapshot.state,
  });
  if (save.status !== "saved") {
    throw new Error("seed save failed");
  }
  return store;
}

describe("createByterangeSegmentResponse", () => {
  test("serves the full virtual segment when no Range is requested", async () => {
    const parts = [makePart(0, 0, 100), makePart(1, 100, 80)];
    const store = await seedStore(parts);
    const client = createFakeS3(parts);

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(180);
    for (let i = 0; i < body.length; i += 1) {
      expect(body[i]).toBe(i % 256);
    }
  });

  test("serves an interior byte range across two part objects", async () => {
    const parts = [makePart(0, 0, 100), makePart(1, 100, 80)];
    const store = await seedStore(parts);
    const client = createFakeS3(parts);

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      range: { end: 119, start: 80 },
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    expect(response.status).toBe(206);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(40);
    for (let i = 0; i < body.length; i += 1) {
      expect(body[i]).toBe((80 + i) % 256);
    }
  });

  test("404s when the virtual segment has no committed parts", async () => {
    const store = await seedStore([]);
    const client = createFakeS3([]);

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(0);
  });

  test("rejects negative range start", async () => {
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    const client = createFakeS3(parts);

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      range: { start: -10 },
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    expect(response.status).toBe(416);
  });
});
