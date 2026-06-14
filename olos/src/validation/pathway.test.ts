import { describe, expect, test } from "bun:test";
import type { Pathway } from "../types/pathway";
import { assertPathway, isPathway } from "./pathway";

const validPathway: Pathway = {
  baseUrl: "https://media.example.com",
  pathwayId: "primary",
  priority: 0,
  providerId: "provider_1",
  state: "active",
};

describe("pathway validation", () => {
  test("accepts a valid pathway", () => {
    expect(() => assertPathway(validPathway)).not.toThrow();
    expect(isPathway(validPathway)).toBe(true);
  });

  test("accepts HTTP base URLs", () => {
    expect(() =>
      assertPathway({ ...validPathway, baseUrl: "http://localhost:8080" })
    ).not.toThrow();
  });

  test("rejects non-object values", () => {
    expect(() => assertPathway(null)).toThrow("pathway must be an object");
    expect(isPathway(null)).toBe(false);
  });

  test("rejects unsafe identifiers", () => {
    expect(() =>
      assertPathway({ ...validPathway, pathwayId: "../primary" })
    ).toThrow("pathway.pathwayId must be a non-empty URL-safe identifier");

    expect(() =>
      assertPathway({ ...validPathway, providerId: "../provider" })
    ).toThrow("pathway.providerId must be a non-empty URL-safe identifier");
  });

  test("rejects invalid base URLs", () => {
    expect(() => assertPathway({ ...validPathway, baseUrl: "" })).toThrow(
      "pathway.baseUrl must be an absolute HTTP(S) URL"
    );

    expect(() => assertPathway({ ...validPathway, baseUrl: "/media" })).toThrow(
      "pathway.baseUrl must be an absolute HTTP(S) URL"
    );

    expect(() =>
      assertPathway({ ...validPathway, baseUrl: "ftp://media.example.com" })
    ).toThrow("pathway.baseUrl must be an absolute HTTP(S) URL");

    expect(() =>
      assertPathway({
        ...validPathway,
        baseUrl: "https://media.example.com/live?token=abc",
      })
    ).toThrow("pathway.baseUrl must not contain query strings or fragments");

    expect(() =>
      assertPathway({
        ...validPathway,
        baseUrl: "https://media.example.com/live#media",
      })
    ).toThrow("pathway.baseUrl must not contain query strings or fragments");
  });

  test("rejects invalid priority", () => {
    expect(() => assertPathway({ ...validPathway, priority: -1 })).toThrow(
      "pathway.priority must be a non-negative integer"
    );
  });

  test("rejects invalid state", () => {
    expect(() => assertPathway({ ...validPathway, state: "warming" })).toThrow(
      "pathway.state must be one of:"
    );
  });
});
