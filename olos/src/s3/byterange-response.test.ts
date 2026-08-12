import { describe, expect, test } from "bun:test";
import type {
  GetObjectCommandInput,
  GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createMemoryCoordinatorStore } from "../protocol/coordinator-memory-store";
import type { CoordinatorPipelineSnapshot } from "../protocol/coordinator-types";
import type {
  CommittedPart,
  CommittedSegment,
} from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import { createByterangeSegmentResponse } from "./byterange-response";
import type { ByterangeCursorWait, S3GetObjectClient } from "./byterange-types";

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
            deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
            objectKey: "media/v1080/init.mp4",
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

const TIMED_OUT = Symbol("timed out");

/**
 * Read the response body to completion, resolving with the stream error (or
 * `undefined` on a clean read). The timeout guard makes a regression that
 * loops forever fail the test instead of hanging it.
 */
async function readStreamError(
  response: Response,
  timeoutMs = 1000
): Promise<unknown> {
  return await Promise.race([
    response.arrayBuffer().then(
      () => undefined,
      (cause: unknown) => cause
    ),
    new Promise((resolve) => {
      setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    }),
  ]);
}

/**
 * Await `promise` or resolve with {@link TIMED_OUT}, so a regression that
 * never settles fails the test instead of hanging it.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = 1000
): Promise<T | typeof TIMED_OUT> {
  return await Promise.race([
    promise,
    new Promise<typeof TIMED_OUT>((resolve) => {
      setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    }),
  ]);
}

/**
 * Fake S3 client whose part body enqueues one chunk and then stalls forever,
 * for tests that need a read in flight when the response is torn down.
 * `bodyCancelled` resolves once the underlying part stream is cancelled.
 */
function createStallingS3(chunk: Uint8Array): {
  bodyCancelled: Promise<void>;
  client: S3GetObjectClient;
} {
  let resolveCancelled: () => void;
  const bodyCancelled = new Promise<void>((resolve) => {
    resolveCancelled = resolve;
  });
  const body = {
    transformToWebStream(): ReadableStream<Uint8Array> {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          // No close: the next read stalls until the stream is cancelled.
        },
        cancel() {
          resolveCancelled();
        },
      });
    },
  };
  const client: S3GetObjectClient = {
    send: () =>
      Promise.resolve({ Body: body } as unknown as GetObjectCommandOutput),
  };
  return { bodyCancelled, client };
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
    expect(response.headers.get("content-range")).toBe("bytes 80-119/*");
    expect(response.headers.get("content-length")).toBe("40");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(40);
    for (let i = 0; i < body.length; i += 1) {
      expect(body[i]).toBe((80 + i) % 256);
    }
  });

  test("serves open-ended offset requests as 206 with an open-ended content-range", async () => {
    const parts = [makePart(0, 0, 100), makePart(1, 100, 80)];
    const store = await seedStore(parts);
    const client = createFakeS3(parts);

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      range: { start: 50 },
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      "bytes 50-9007199254740991/*"
    );
    expect(response.headers.get("content-length")).toBeNull();
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(130);
    for (let i = 0; i < body.length; i += 1) {
      expect(body[i]).toBe((50 + i) % 256);
    }
  });

  test("errors the stream when a part object returns no body", async () => {
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    const client: S3GetObjectClient = {
      send: () => Promise.resolve({} as GetObjectCommandOutput),
    };

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    const error = await readStreamError(response);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("returned no body");
  });

  test("errors the stream when a part object returns zero bytes", async () => {
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    const body = {
      transformToWebStream(): ReadableStream<Uint8Array> {
        return new ReadableStream({
          start(controller) {
            controller.close();
          },
        });
      },
    };
    const client: S3GetObjectClient = {
      send: () =>
        Promise.resolve({ Body: body } as unknown as GetObjectCommandOutput),
    };

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    const error = await readStreamError(response);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("returned no bytes");
  });

  test("surfaces the Range error when a part object is shorter than its committed byterange", async () => {
    // The window commits the part as 100 bytes, but only 60 landed in
    // storage. After streaming the 60 real bytes the helper re-requests the
    // missing tail with `Range: bytes=60-99`; a real S3 rejects that with an
    // InvalidRange (416-style) error, which must error the stream instead of
    // closing the bounded 206 short.
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    const actualSize = 60;
    const requestedRanges: (string | undefined)[] = [];
    const client: S3GetObjectClient = {
      send: (command) => {
        requestedRanges.push(command.input.Range);
        const rangeMatch = command.input.Range?.match(RANGE_PATTERN);
        const start =
          rangeMatch === null || rangeMatch === undefined
            ? 0
            : Number(rangeMatch[1]);
        if (start >= actualSize) {
          return Promise.reject(
            new Error("InvalidRange: The requested range is not satisfiable")
          );
        }
        const end = Math.min(
          rangeMatch === null || rangeMatch === undefined
            ? actualSize - 1
            : Number(rangeMatch[2]),
          actualSize - 1
        );
        const slice = new Uint8Array(end - start + 1);
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
        return Promise.resolve({
          Body: body,
        } as unknown as GetObjectCommandOutput);
      },
    };

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      range: { end: 99, start: 0 },
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("100");
    const error = await readStreamError(response);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("InvalidRange");
    expect(requestedRanges).toEqual(["bytes=0-99", "bytes=60-99"]);
  });

  test("errors a bounded range when the committed parts end early", async () => {
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    const client = createFakeS3(parts);

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      range: { end: 149, start: 0 },
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-149/*");
    expect(response.headers.get("content-length")).toBe("150");
    const error = await readStreamError(response);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("ended before requested end");
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

  test("consumer cancellation cancels the in-flight part body", async () => {
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    const { bodyCancelled, client } = createStallingS3(new Uint8Array(10));

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    const body = response.body;
    if (body === null) {
      throw new Error("expected a response body");
    }
    const reader = body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();

    expect(await withTimeout(bodyCancelled)).not.toBe(TIMED_OUT);
  });

  test("request signal abort cancels the in-flight part body", async () => {
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    const { bodyCancelled, client } = createStallingS3(new Uint8Array(10));
    const viewer = new AbortController();

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      signal: viewer.signal,
      store,
    });

    const body = response.body;
    if (body === null) {
      throw new Error("expected a response body");
    }
    const reader = body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    viewer.abort();

    expect(await withTimeout(bodyCancelled)).not.toBe(TIMED_OUT);
  });

  test("pre-aborted signal never invokes cursorWait", async () => {
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    const client = createFakeS3(parts);
    const viewer = new AbortController();
    viewer.abort();
    let waits = 0;
    const cursorWait: ByterangeCursorWait = () => {
      waits += 1;
      return Promise.resolve(undefined);
    };

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      cursorWait,
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      signal: viewer.signal,
      store,
    });

    const body = await withTimeout(response.arrayBuffer());
    expect(body).not.toBe(TIMED_OUT);
    expect(new Uint8Array(body as ArrayBuffer).length).toBe(0);
    expect(waits).toBe(0);
    expect(client.inputs.length).toBe(0);
  });

  test("bounded 206 clamps a part body that overshoots the requested range", async () => {
    const parts = [makePart(0, 0, 100)];
    const store = await seedStore(parts);
    // A loose client that ignores `Range` and always returns the whole part.
    const client: S3GetObjectClient = {
      send: () => {
        const partBytes = new Uint8Array(100);
        for (let i = 0; i < partBytes.length; i += 1) {
          partBytes[i] = i % 256;
        }
        const body = {
          transformToWebStream(): ReadableStream<Uint8Array> {
            return new ReadableStream({
              start(controller) {
                controller.enqueue(partBytes);
                controller.close();
              },
            });
          },
        };
        return Promise.resolve({
          Body: body,
        } as unknown as GetObjectCommandOutput);
      },
    };

    const response = await createByterangeSegmentResponse({
      bucket: "media",
      client,
      range: { end: 49, start: 0 },
      segmentObjectKey: SEGMENT_OBJECT_KEY,
      sessionId: SESSION_ID,
      store,
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("50");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBe(50);
    for (let i = 0; i < body.length; i += 1) {
      expect(body[i]).toBe(i % 256);
    }
  });
});
