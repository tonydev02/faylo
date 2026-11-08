import assert from "node:assert/strict";
import test from "node:test";
import { createAuthSessionHandler } from "../src/lib/auth/api-response.ts";
import { determineOwnerAccess, safeReturnPath } from "../src/lib/auth/access-policy.ts";

const approvedUserId = "a1111111-1111-4111-8111-111111111111";
const otherUserId = "b2222222-2222-4222-8222-222222222222";

function verified(userId) {
  return { kind: "verified", userId };
}

test("only the configured, server-verified Supabase user is approved", () => {
  assert.equal(determineOwnerAccess(verified(approvedUserId), approvedUserId), "allowed");
  assert.equal(determineOwnerAccess(verified(otherUserId), approvedUserId), "forbidden");
  assert.equal(determineOwnerAccess(verified(approvedUserId.toUpperCase()), approvedUserId), "allowed");
});

test("missing, invalid, and expired sessions are denied", () => {
  for (const kind of ["missing", "invalid", "expired"]) {
    assert.equal(determineOwnerAccess({ kind }, approvedUserId), "unauthenticated", kind);
  }
});

test("missing or malformed owner configuration never grants access", () => {
  assert.equal(determineOwnerAccess(verified(approvedUserId), null), "misconfigured");
  assert.equal(determineOwnerAccess(verified(approvedUserId), "not-a-uuid"), "misconfigured");
});

test("auth service failures fail closed without being reported as an anonymous session", () => {
  assert.equal(determineOwnerAccess({ kind: "unavailable" }, approvedUserId), "unavailable");
});

test("return paths accept only local application paths", () => {
  assert.equal(safeReturnPath("/settings?tab=profile#security"), "/settings?tab=profile#security");
  for (const value of [
    "https://attacker.example/",
    "//attacker.example/",
    "/a/..//attacker.example/",
    "/\\attacker.example/",
    "javascript:alert(1)",
    "/login",
    "/auth/callback?code=stolen",
    "/api/auth/session",
    "/\r\nLocation: https://attacker.example",
    `/${"x".repeat(2048)}`,
    null,
  ]) {
    assert.equal(safeReturnPath(value), "/", String(value));
  }
});

test("the private session API returns no-store and denies anonymous or unapproved requests", async () => {
  const scenarios = [
    [{ status: "unauthenticated" }, 401, "unauthorized"],
    [{ status: "forbidden" }, 403, "forbidden"],
    [{ status: "misconfigured" }, 503, "auth_unavailable"],
    [{ status: "unavailable" }, 503, "auth_unavailable"],
  ];

  for (const [access, expectedStatus, expectedError] of scenarios) {
    const GET = createAuthSessionHandler(async () => access);
    const response = await GET();
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: expectedError });
  }
});

test("the private session API exposes only an authenticated flag to the approved owner", async () => {
  const GET = createAuthSessionHandler(async () => ({
    status: "allowed",
    user: { id: approvedUserId, email: "owner@example.test" },
  }));
  const response = await GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { authenticated: true });
});

test("API authorization fails closed if the verifier throws", async () => {
  const GET = createAuthSessionHandler(async () => {
    throw new Error("verification unavailable");
  });
  const response = await GET();

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "auth_unavailable" });
});
