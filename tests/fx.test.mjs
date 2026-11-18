import assert from "node:assert/strict";
import test from "node:test";
import { expandDecimalExponent, isPositiveDecimal, multiplyDecimalAndRoundToInteger } from "../src/lib/transactions/fx-decimal.ts";
import { lookupFrankfurterRate } from "../src/lib/transactions/fx-provider.ts";
import { tokyoDateToday } from "../src/lib/transactions/fx-types.ts";

const response = (body, status = 200, headers = {}) => new Response(body, { status, headers });


test("exact FX multiplication rounds per transaction to whole yen, with ties away from zero", () => {
  assert.equal(multiplyDecimalAndRoundToInteger("1", "1.49"), "1");
  assert.equal(multiplyDecimalAndRoundToInteger("1", "1.5"), "2");
  assert.equal(multiplyDecimalAndRoundToInteger("1", "1.51"), "2");
  assert.equal(multiplyDecimalAndRoundToInteger("-1", "1.49"), "-1");
  assert.equal(multiplyDecimalAndRoundToInteger("-1", "1.5"), "-2");
  assert.equal(multiplyDecimalAndRoundToInteger("-1", "1.51"), "-2");
  assert.equal(multiplyDecimalAndRoundToInteger("9007199254740993.45", "1"), "9007199254740993");
  assert.equal(multiplyDecimalAndRoundToInteger("0.0049", "1"), "0");
});

test("provider decimal exponents expand exactly without binary floating point", () => {
  assert.equal(expandDecimalExponent("1.234e2"), "123.4");
  assert.equal(expandDecimalExponent("1.234e-2"), "0.01234");
  assert.equal(expandDecimalExponent("-5E+1"), "-50");
  assert.equal(expandDecimalExponent("1e10001"), null);
  assert.equal(isPositiveDecimal("0.0001"), true);
  assert.equal(isPositiveDecimal("0"), false);
  assert.equal(isPositiveDecimal("1e-8"), false);
});

test("historical lookup keeps the exact numeric token and selects the latest eligible effective date", async () => {
  const payload = '[{"date":"2026-11-10","base":"USD","quote":"JPY","rate":149.1,"providers":[{"key":"ECB","date":"2026-11-10","rate":149.1}]},{"date":"2026-11-14","base":"USD","quote":"JPY","rate":150.123456789123456789,"description":"literal \\"rate\\": 777","providers":[{"key":"ECB","date":"2026-11-14","rate":150.123456789123456789},{"key":"EXCLUDED","date":"2026-11-14","rate":1.2,"excluded":true}]}]';
  let requestUrl;
  const result = await lookupFrankfurterRate("USD", "2026-11-17", {
    fetcher: async (url) => {
      requestUrl = new URL(url);
      return response(payload);
    },
    now: () => Date.parse("2026-11-17T03:00:00.000Z"),
  });

  assert.equal(requestUrl.pathname, "/v2/rates");
  assert.equal(requestUrl.searchParams.get("base"), "USD");
  assert.equal(requestUrl.searchParams.get("quotes"), "JPY");
  assert.equal(requestUrl.searchParams.get("from"), "2026-11-10");
  assert.equal(requestUrl.searchParams.get("to"), "2026-11-17");
  assert.equal(requestUrl.searchParams.get("expand"), "providers");
  assert.equal(result.kind, "found");
  if (result.kind !== "found") return;
  assert.equal(result.selected.effectiveOn, "2026-11-14");
  assert.equal(result.selected.rate, "150.123456789123456789");
  assert.deepEqual(result.selected.providers, ["ECB"]);
});

test("historical lookup rejects stale and future provider dates and never substitutes them", async () => {
  const stale = await lookupFrankfurterRate("USD", "2026-11-17", {
    fetcher: async () => response('[{"date":"2026-11-09","base":"USD","quote":"JPY","rate":150}]'),
  });
  assert.equal(stale.kind, "unavailable");

  const future = await lookupFrankfurterRate("USD", "2026-11-17", {
    fetcher: async () => response('[{"date":"2026-11-18","base":"USD","quote":"JPY","rate":150}]'),
  });
  assert.equal(future.kind, "unavailable");

  const absent = await lookupFrankfurterRate("USD", "2026-11-17", { fetcher: async () => response("[]") });
  assert.equal(absent.kind, "unavailable");
});

test("provider pair and malformed payloads fail closed without retry", async () => {
  let calls = 0;
  const mismatched = await lookupFrankfurterRate("USD", "2026-11-17", {
    fetcher: async () => {
      calls += 1;
      return response('[{"date":"2026-11-17","base":"EUR","quote":"JPY","rate":150}]');
    },
  });
  assert.equal(mismatched.kind, "unresolved");
  assert.equal(calls, 1);

  calls = 0;
  const malformed = await lookupFrankfurterRate("USD", "2026-11-17", {
    fetcher: async () => {
      calls += 1;
      return response("not-json");
    },
  });
  assert.equal(malformed.kind, "unresolved");
  assert.equal(calls, 1);
});

test("network and server failures retry once and unresolved failures stay retryable", async () => {
  let calls = 0;
  const result = await lookupFrankfurterRate("USD", "2026-11-17", {
    fetcher: async () => {
      calls += 1;
      return response("{}", 503);
    },
    sleep: async () => {},
    random: () => 0,
  });
  assert.equal(result.kind, "unresolved");
  assert.equal(calls, 2);

  calls = 0;
  const recovered = await lookupFrankfurterRate("USD", "2026-11-17", {
    fetcher: async () => {
      calls += 1;
      return calls === 1
        ? response("{}", 429, { "Retry-After": "0" })
        : response('[{"date":"2026-11-17","base":"USD","quote":"JPY","rate":150}]');
    },
    sleep: async () => {},
    random: () => 0,
  });
  assert.equal(recovered.kind, "found");
  assert.equal(calls, 2);
});

test("invalid requests do not make a provider call", async () => {
  let calls = 0;
  const result = await lookupFrankfurterRate("JPY", "2026-11-17", {
    fetcher: async () => {
      calls += 1;
      return response("[]");
    },
  });
  assert.equal(result.kind, "unresolved");
  assert.equal(calls, 0);
});

test("FX eligibility uses the Tokyo economic-date boundary", () => {
  assert.equal(tokyoDateToday(new Date("2026-11-17T14:59:59.999Z")), "2026-11-17");
  assert.equal(tokyoDateToday(new Date("2026-11-17T15:00:00.000Z")), "2026-11-18");
});
