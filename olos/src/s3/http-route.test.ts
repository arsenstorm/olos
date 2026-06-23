import { describe, expect, test } from "bun:test";
import {
  S3_ROUTE_ACTIONS,
  s3CompletionHintRoutePathFromOptions,
  s3RoutePathFromOptions,
} from "../runtime/route";
import { s3Route } from "./http-route";

const routeOptions = {
  sessionPath: "/sessions",
};

describe("S3 HTTP route matching", () => {
  test("matches S3 session action routes", () => {
    expect(
      s3Route(
        routeRequest(
          s3RoutePathFromOptions(
            "session_1",
            S3_ROUTE_ACTIONS.reconcilePlan,
            routeOptions
          )
        ),
        routeOptions
      )
    ).toEqual({
      action: "reconcile-plan",
      sessionId: "session_1",
      status: "matched",
    });
  });

  test("matches S3 completion hint routes", () => {
    expect(
      s3Route(
        routeRequest(
          s3CompletionHintRoutePathFromOptions(
            "session_1",
            "slot_1",
            routeOptions
          )
        ),
        routeOptions
      )
    ).toEqual({
      action: "completion-hint",
      sessionId: "session_1",
      slotId: "slot_1",
      status: "matched",
    });
  });

  test("does not match completion hint routes with extra path segments", () => {
    expect(
      s3Route(
        routeRequest(
          `${s3CompletionHintRoutePathFromOptions(
            "session_1",
            "slot_1",
            routeOptions
          )}/extra`
        ),
        routeOptions
      )
    ).toEqual({ status: "not_s3" });
  });

  test("rejects unsupported methods before route identifier validation", () => {
    expect(
      s3Route(
        routeRequest("/sessions/bad%21/upload-slots/slot_1/complete", "GET"),
        routeOptions
      )
    ).toEqual({ status: "method_not_allowed" });
  });

  test("reports invalid route identifiers", () => {
    expect(
      s3Route(
        routeRequest(
          s3CompletionHintRoutePathFromOptions(
            "session_1",
            "../slot",
            routeOptions
          )
        ),
        routeOptions
      )
    ).toEqual({
      message: "slotId must be a non-empty URL-safe identifier",
      status: "invalid",
    });
  });

  test("reports malformed route percent encoding", () => {
    expect(
      s3Route(routeRequest("/sessions/session_1/s3/slots%"), routeOptions)
    ).toEqual({
      message: "route path contains invalid percent encoding",
      status: "invalid",
    });
  });

  test("ignores non-S3 routes", () => {
    expect(s3Route(routeRequest("/health"), routeOptions)).toEqual({
      status: "not_s3",
    });
  });
});

function routeRequest(path: string, method = "POST"): Request {
  return new Request(`https://example.com${path}`, { method });
}
