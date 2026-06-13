import type { CoordinatorRetentionPlan } from "../protocol";
import type { RuntimeLiveHealth } from "./health";
import type { RuntimePublisherLease } from "./publisher-lease";

export type RuntimeFetch = (
  input: Request | URL | string,
  init?: RequestInit
) => Promise<Response>;

export interface RuntimeHttpClientOptions {
  baseUrl: string;
  fetch?: RuntimeFetch;
}

export interface RuntimePublisherHeartbeatOptions
  extends RuntimeHttpClientOptions {
  publisherInstanceId: string;
  sessionId: string;
}

export interface RuntimeSessionHealthOptions extends RuntimeHttpClientOptions {
  publisherInstanceId?: string;
  sessionId: string;
}

export interface RuntimeSessionRetentionOptions
  extends RuntimeHttpClientOptions {
  now?: string;
  sessionId: string;
}

export interface RuntimePublisherHeartbeatResponse {
  lease: RuntimePublisherLease;
  response: Response;
}

export interface RuntimeSessionHealthResponse {
  health: RuntimeLiveHealth;
  response: Response;
}

export interface RuntimeSessionRetentionResponse {
  plan: CoordinatorRetentionPlan;
  response: Response;
}

export async function sendRuntimePublisherHeartbeat(
  options: RuntimePublisherHeartbeatOptions
): Promise<RuntimePublisherHeartbeatResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "heartbeat"),
    {
      body: JSON.stringify({
        publisherInstanceId: options.publisherInstanceId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error(
      `publisher heartbeat failed with status ${response.status}`
    );
  }

  return {
    lease: leasePayload(await response.json()),
    response,
  };
}

export async function getRuntimeSessionHealth(
  options: RuntimeSessionHealthOptions
): Promise<RuntimeSessionHealthResponse> {
  const url = sessionUrl(options.baseUrl, options.sessionId, "health");

  if (options.publisherInstanceId !== undefined) {
    url.searchParams.set("publisherInstanceId", options.publisherInstanceId);
  }

  const response = await fetchFor(options)(url);

  if (!response.ok) {
    throw new Error(`session health failed with status ${response.status}`);
  }

  return {
    health: healthPayload(await response.json()),
    response,
  };
}

export async function getRuntimeSessionRetentionPlan(
  options: RuntimeSessionRetentionOptions
): Promise<RuntimeSessionRetentionResponse> {
  const url = sessionUrl(options.baseUrl, options.sessionId, "retention");

  if (options.now !== undefined) {
    url.searchParams.set("now", options.now);
  }

  const response = await fetchFor(options)(url);

  if (!response.ok) {
    throw new Error(`session retention failed with status ${response.status}`);
  }

  return {
    plan: retentionPayload(await response.json()),
    response,
  };
}

function sessionUrl(baseUrl: string, sessionId: string, action: string): URL {
  return new URL(
    `sessions/${encodeURIComponent(sessionId)}/${action}`,
    normalizedBaseUrl(baseUrl)
  );
}

function normalizedBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function fetchFor(options: RuntimeHttpClientOptions): RuntimeFetch {
  return options.fetch ?? fetch;
}

function leasePayload(value: unknown): RuntimePublisherLease {
  if (!(isRecord(value) && isRecord(value.lease))) {
    throw new Error("publisher heartbeat response must include a lease");
  }

  return value.lease as unknown as RuntimePublisherLease;
}

function healthPayload(value: unknown): RuntimeLiveHealth {
  if (!(isRecord(value) && isRecord(value.health))) {
    throw new Error("session health response must include health");
  }

  return value.health as unknown as RuntimeLiveHealth;
}

function retentionPayload(value: unknown): CoordinatorRetentionPlan {
  if (!(isRecord(value) && isRecord(value.plan))) {
    throw new Error("session retention response must include a plan");
  }

  return value.plan as unknown as CoordinatorRetentionPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
