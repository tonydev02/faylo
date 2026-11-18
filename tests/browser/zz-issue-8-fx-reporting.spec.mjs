import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { AUTH_STATE_PATH, TEST_OWNER_ID } from "./constants.mjs";
import { formatMoney } from "../../src/lib/accounts/money.ts";

const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? "";
const OWNER_ID = process.env.FAYLO_BROWSER_TEST_OWNER_ID ?? TEST_OWNER_ID;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function tokyoToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function apiJson(request, pathName, token, body = undefined) {
  const response = await request.fetch(`${SUPABASE_URL}${pathName}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(body === undefined ? {} : { Prefer: "return=representation" }),
    },
    ...(body === undefined ? {} : { data: body }),
  });
  const text = await response.text();
  let value;
  try {
    value = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  if (!response.ok()) throw new Error(`${pathName} failed (${response.status()}): ${JSON.stringify(value)}`);
  return value;
}

async function captureScreenshot(page, filename, regionName = null) {
  const outputDirectory = process.env.SAVE_BROWSER_SCREENSHOTS === "1" ? "docs/screenshots" : "test-results";
  const outputPath = path.resolve(process.cwd(), outputDirectory, filename);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const target = regionName ? page.getByRole("region", { name: regionName }) : page.locator("main");
  await target.screenshot({ path: outputPath });
}

function automaticSnapshot(transactionId, today, rate) {
  return {
    p_transaction_id: transactionId,
    p_idempotency_key: randomUUID(),
    p_status: "resolved",
    p_rate_to_jpy: rate,
    p_source_kind: "frankfurter_blended",
    p_provider_code: "frankfurter",
    p_rate_effective_on: today,
    p_fetched_at: new Date().toISOString(),
    p_provider_metadata: { providers: ["ECB"] },
    p_resolution_reason: null,
    p_cache_rates: [{ effective_on: today, rate, providers: ["ECB"] }],
    p_cache_requested_from: shiftDate(today, -7),
    p_cache_requested_through: today,
  };
}

async function postSyntheticTransaction(request, token, { categoryId, kind, amount, currency, occurredOn, merchant }) {
  return apiJson(request, "/rest/v1/rpc/post_transaction", token, {
    p_idempotency_key: randomUUID(),
    p_transaction_kind: kind,
    p_occurred_on: occurredOn,
    p_amount: amount,
    p_currency_code: currency,
    p_category_id: categoryId,
    p_payment_method_id: null,
    p_entries: [],
    p_source: "manual",
    p_merchant: merchant,
    p_note: "Synthetic local browser fixture; not real financial data.",
    p_adjustment_reason: null,
    p_occurred_at: null,
  });
}

async function listFxRevisions(request, token, transactionId) {
  const query = new URLSearchParams({
    select: "id,revision,status,source_kind,rate_to_jpy,converted_amount_jpy,override_note,created_at",
    transaction_id: `eq.${transactionId}`,
    order: "revision.asc",
  });
  return apiJson(request, `/rest/v1/transaction_reporting_fx_snapshots?${query.toString()}`, token);
}

test("Issue 8 historical FX reporting is authenticated, exact, auditable, and responsive", async ({ page, browser, request }) => {
  const supabaseOrigin = new URL(SUPABASE_URL).origin;
  assert.ok(LOOPBACK_HOSTS.has(new URL(supabaseOrigin).hostname), "FX browser tests must use local Supabase only");
  assert.ok(PUBLISHABLE_KEY.length > 0, "local Supabase publishable key is required");

  const authState = JSON.parse(await readFile(path.resolve(process.cwd(), AUTH_STATE_PATH), "utf8"));
  const cookie = authState.cookies.find((item) => item.value.startsWith("base64-"));
  assert.ok(cookie, "authenticated local browser session cookie must exist");
  const session = JSON.parse(Buffer.from(cookie.value.slice("base64-".length), "base64url").toString("utf8"));
  assert.equal(session.user.id, OWNER_ID);
  const token = session.access_token;
  const today = tokyoToday();
  await apiJson(request, "/rest/v1/accounts", token, [{
    user_id: OWNER_ID,
    name: `Synthetic FX browser account ${OWNER_ID.slice(0, 8)}`,
    account_kind: "cash",
    currency_code: "JPY",
    opening_balance: "0",
    opening_as_of: shiftDate(today, -1),
  }]);
  const incomeName = `Synthetic FX income ${OWNER_ID.slice(0, 8)}`;
  const expenseName = `Synthetic FX expense ${OWNER_ID.slice(0, 8)}`;
  const categories = await apiJson(request, "/rest/v1/categories", token, [
    { user_id: OWNER_ID, kind: "income", name: incomeName },
    { user_id: OWNER_ID, kind: "expense", name: expenseName },
  ]);
  const incomeCategoryId = categories.find((category) => category.kind === "income")?.id;
  const expenseCategoryId = categories.find((category) => category.kind === "expense")?.id;
  assert.ok(incomeCategoryId && expenseCategoryId, "synthetic test categories must be created");

  const resolvedId = await postSyntheticTransaction(request, token, {
    categoryId: incomeCategoryId,
    kind: "income",
    amount: "10.01",
    currency: "USD",
    occurredOn: today,
    merchant: "Synthetic resolved income",
  });
  await apiJson(request, "/rest/v1/rpc/record_transaction_reporting_fx_snapshot", token, automaticSnapshot(resolvedId, today, "150.25"));

  const unavailableId = await postSyntheticTransaction(request, token, {
    categoryId: expenseCategoryId,
    kind: "expense",
    amount: "4.00",
    currency: "USD",
    occurredOn: today,
    merchant: "Synthetic unavailable expense",
  });
  await apiJson(request, "/rest/v1/rpc/record_transaction_reporting_fx_snapshot", token, {
    p_transaction_id: unavailableId,
    p_idempotency_key: randomUUID(),
    p_status: "unavailable",
    p_rate_to_jpy: null,
    p_source_kind: "unresolved",
    p_provider_code: "frankfurter",
    p_rate_effective_on: null,
    p_fetched_at: new Date().toISOString(),
    p_provider_metadata: { failure: "synthetic_no_rate" },
    p_resolution_reason: "No synthetic provider observation was supplied for this test transaction.",
    p_cache_rates: [],
    p_cache_requested_from: null,
    p_cache_requested_through: null,
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/transactions/${resolvedId}`);
  await expect(page.getByRole("heading", { name: "Synthetic resolved income" })).toBeVisible();
  await expect(page.getByText("JPY equivalent · the original USD amount remains primary.", { exact: true })).toBeVisible();
  const reportingPanel = page.getByRole("region", { name: "Reporting conversion" });
  await expect(reportingPanel.getByText("¥1,504", { exact: true }).first()).toBeVisible();
  await page.getByText("Edit reporting rate", { exact: true }).click();
  await page.getByLabel("JPY per 1 USD").fill("151.25");
  await page.getByLabel("Rate effective date").fill(today);
  await page.getByLabel("Why are you overriding the reporting rate?").fill("Synthetic browser override; not a real transfer or settlement rate.");
  await expect(page.getByText(/Preview · 10\.01 USD × 151\.25 = ¥1,514 JPY/)).toBeVisible();
  await page.getByRole("button", { name: "Save manual reporting rate" }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions/${resolvedId}\\?fx=updated$`));
  await expect(page.getByRole("status")).toContainText("Manual reporting rate saved as a new immutable FX revision.");
  await expect(reportingPanel.getByText("¥1,514", { exact: true }).first()).toBeVisible();

  const concurrentA = {
    p_transaction_id: resolvedId,
    p_idempotency_key: randomUUID(),
    p_rate_to_jpy: "152.25",
    p_rate_effective_on: today,
    p_override_note: "Synthetic concurrent manual revision A.",
  };
  const concurrentB = {
    ...concurrentA,
    p_idempotency_key: randomUUID(),
    p_rate_to_jpy: "152.50",
    p_override_note: "Synthetic concurrent manual revision B.",
  };
  const [revisionA, revisionB] = await Promise.all([
    apiJson(request, "/rest/v1/rpc/override_transaction_reporting_fx", token, concurrentA),
    apiJson(request, "/rest/v1/rpc/override_transaction_reporting_fx", token, concurrentB),
  ]);
  assert.notEqual(revisionA, revisionB, "different concurrent manual edits must create distinct audited revisions");
  assert.deepEqual((await listFxRevisions(request, token, resolvedId)).map((row) => row.revision), [1, 2, 3, 4]);

  const [replayedA, replayedB] = await Promise.all([
    apiJson(request, "/rest/v1/rpc/override_transaction_reporting_fx", token, concurrentA),
    apiJson(request, "/rest/v1/rpc/override_transaction_reporting_fx", token, concurrentA),
  ]);
  assert.equal(replayedA, revisionA);
  assert.equal(replayedB, revisionA);
  const changedReplay = await request.post(`${SUPABASE_URL}/rest/v1/rpc/override_transaction_reporting_fx`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { ...concurrentA, p_rate_to_jpy: "152.26" },
  });
  assert.equal(changedReplay.ok(), false, "reusing an override key with changed content must be rejected");

  const revisionsBeforeAutomatic = await listFxRevisions(request, token, resolvedId);
  const latestManualId = revisionsBeforeAutomatic.at(-1).id;
  const automaticReplay = automaticSnapshot(resolvedId, today, "150.25");
  assert.equal(await apiJson(request, "/rest/v1/rpc/record_transaction_reporting_fx_snapshot", token, automaticReplay), latestManualId);
  assert.equal((await listFxRevisions(request, token, resolvedId)).length, 4, "automatic resolution must not append over a manual revision");

  await page.goto(`/transactions/${resolvedId}`);
  await expect(page.getByText("Manual reporting override", { exact: true })).toBeVisible();
  await page.getByText("Revision history · 4 revisions", { exact: true }).click();
  await expect(page.getByText(/Explanation: Synthetic browser override; not a real transfer or settlement rate\./)).toBeVisible();
  await expect(page.getByText(/Explanation: Synthetic concurrent manual revision A\./)).toBeVisible();
  await expect(page.getByText(/Explanation: Synthetic concurrent manual revision B\./)).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await captureScreenshot(page, "issue-8-resolved-desktop.png", "Reporting conversion");

  const futureDate = shiftDate(today, 1);
  const pendingId = await postSyntheticTransaction(request, token, {
    categoryId: expenseCategoryId,
    kind: "expense",
    amount: "999.00",
    currency: "USD",
    occurredOn: futureDate,
    merchant: "Synthetic future-effective expense",
  });
  await apiJson(request, "/rest/v1/rpc/record_transaction_reporting_fx_snapshot", token, {
    p_transaction_id: pendingId,
    p_idempotency_key: randomUUID(),
    p_status: "pending_future",
    p_rate_to_jpy: null,
    p_source_kind: "unresolved",
    p_provider_code: null,
    p_rate_effective_on: null,
    p_fetched_at: null,
    p_provider_metadata: {},
    p_resolution_reason: "Synthetic future event remains ineligible until its Tokyo economic date.",
    p_cache_rates: [],
    p_cache_requested_from: null,
    p_cache_requested_through: null,
  });
  await page.goto(`/transactions/${pendingId}`);
  await expect(page.getByRole("region", { name: "Reporting conversion" }).getByText("Pending · future-effective", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`does not affect today(?:'|&apos;)s JPY totals or unresolved counts`))).toBeVisible();
  await captureScreenshot(page, "issue-8-pending-desktop.png", "Reporting conversion");

  await page.goto("/");
  const monthlyTotals = await apiJson(request, "/rest/v1/rpc/transaction_totals", token, {
    p_month_start: `${today.slice(0, 7)}-01`,
  });
  const monthlyIncome = monthlyTotals.find((row) => row.transaction_kind === "income" && row.resolved_total_jpy !== null);
  assert.ok(monthlyIncome, "synthetic resolved income must contribute a monthly JPY subtotal");
  const expectedJpyTotal = formatMoney(String(monthlyIncome.resolved_total_jpy), "JPY");
  const spending = page.getByRole("region", { name: "Spending report" });
  const incompleteLabel = /^Incomplete reference · \d+ included transactions? (?:has|have) no resolved JPY conversion\. Unknown conversions are not treated as zero\.$/;
  await expect(spending.getByText(incompleteLabel)).toBeVisible();
  await expect(page.getByRole("region", { name: "Income report" }).getByText(expectedJpyTotal, { exact: true })).toBeVisible();
  await expect(spending.getByText("Month to date · full-month comparison is not available.", { exact: true })).toBeVisible();
  await expect(page.getByText("JPY conversion unavailable · no eligible historical rate", { exact: true })).toBeVisible();
  await captureScreenshot(page, "issue-8-incomplete-desktop.png");

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    storageState: path.resolve(process.cwd(), AUTH_STATE_PATH),
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(`/transactions/${resolvedId}`);
  await expect(mobile.getByText("Resolved reference conversion", { exact: true })).toBeVisible();
  await mobile.getByText(/Revision history · 4 revisions/).click();
  await captureScreenshot(mobile, "issue-8-resolved-mobile.png", "Reporting conversion");

  await mobile.goto(`/transactions/${pendingId}`);
  await expect(mobile.getByRole("region", { name: "Reporting conversion" }).getByText("Pending · future-effective", { exact: true }).first()).toBeVisible();
  await captureScreenshot(mobile, "issue-8-pending-mobile.png", "Reporting conversion");

  await mobile.goto("/");
  await expect(mobile.getByRole("region", { name: "Spending report" }).getByText(incompleteLabel)).toBeVisible();
  await expect(mobile.getByRole("region", { name: "Spending report" }).getByText("Month to date · full-month comparison is not available.", { exact: true })).toBeVisible();
  const dimensions = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.viewportWidth, `mobile dashboard overflows by ${dimensions.scrollWidth - dimensions.viewportWidth}px`);
  await captureScreenshot(mobile, "issue-8-incomplete-mobile.png", "Spending report");
  await mobileContext.close();
});

test("automatic snapshot resolution racing with voiding cannot append after void completion", async ({ request }) => {
  const authState = JSON.parse(await readFile(path.resolve(process.cwd(), AUTH_STATE_PATH), "utf8"));
  const cookie = authState.cookies.find((item) => item.value.startsWith("base64-"));
  assert.ok(cookie, "authenticated local browser session cookie must exist");
  const session = JSON.parse(Buffer.from(cookie.value.slice("base64-".length), "base64url").toString("utf8"));
  assert.equal(session.user.id, OWNER_ID);
  const token = session.access_token;
  const today = tokyoToday();
  const [category] = await apiJson(request, "/rest/v1/categories", token, [{
    user_id: OWNER_ID,
    kind: "income",
    name: `Synthetic FX void race ${randomUUID()}`,
  }]);
  assert.ok(category?.id, "synthetic FX category must be created");

  const transactionId = await postSyntheticTransaction(request, token, {
    categoryId: category.id,
    kind: "income",
    amount: "1.00",
    currency: "USD",
    occurredOn: today,
    merchant: "Synthetic FX void race",
  });
  const originalSnapshot = automaticSnapshot(transactionId, today, "150.25");
  const originalSnapshotId = await apiJson(
    request,
    "/rest/v1/rpc/record_transaction_reporting_fx_snapshot",
    token,
    originalSnapshot,
  );

  const concurrentResolution = {
    p_transaction_id: transactionId,
    p_idempotency_key: randomUUID(),
    p_status: "unresolved",
    p_rate_to_jpy: null,
    p_source_kind: "unresolved",
    p_provider_code: "frankfurter",
    p_rate_effective_on: null,
    p_fetched_at: null,
    p_provider_metadata: { failure: "concurrent_void_race" },
    p_resolution_reason: "Synthetic concurrent resolver attempt.",
    p_cache_rates: [],
    p_cache_requested_from: null,
    p_cache_requested_through: null,
  };
  const rpcHeaders = {
    apikey: PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const [resolutionResponse, voidResponse] = await Promise.all([
    request.fetch(`${SUPABASE_URL}/rest/v1/rpc/record_transaction_reporting_fx_snapshot`, {
      method: "POST",
      headers: rpcHeaders,
      data: concurrentResolution,
    }),
    request.fetch(`${SUPABASE_URL}/rest/v1/rpc/void_transaction`, {
      method: "POST",
      headers: rpcHeaders,
      data: { p_transaction_id: transactionId, p_reason: "Synthetic concurrent FX void." },
    }),
  ]);
  const resolutionBody = await resolutionResponse.json().catch(() => null);
  const voidBody = await voidResponse.json().catch(() => null);
  assert.ok(voidResponse.ok(), `void RPC failed: ${JSON.stringify(voidBody)}`);
  assert.equal(voidBody, transactionId);
  if (!resolutionResponse.ok()) assert.equal(resolutionBody?.code, "23514");

  const [transactionRows, revisions] = await Promise.all([
    apiJson(request, `/rest/v1/transactions?select=status,voided_at&id=eq.${transactionId}`, token),
    listFxRevisions(request, token, transactionId),
  ]);
  assert.equal(transactionRows[0]?.status, "voided");
  assert.equal(revisions.length, resolutionResponse.ok() ? 2 : 1);
  assert.ok(
    revisions.every((revision) => revision.created_at <= transactionRows[0].voided_at),
    "no FX revision may be created after the void has completed",
  );
  assert.equal(
    await apiJson(request, "/rest/v1/rpc/record_transaction_reporting_fx_snapshot", token, originalSnapshot),
    originalSnapshotId,
    "an identical pre-void idempotent replay still returns its original snapshot",
  );
  assert.equal((await listFxRevisions(request, token, transactionId)).length, revisions.length);
});
