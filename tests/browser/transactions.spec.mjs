import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { AUTH_STATE_PATH } from "./constants.mjs";

async function capture(page, filename, fullPage = true) {
  const outputDirectory = (filename.startsWith("issue-6-") || filename.startsWith("issue-7-")) && process.env.SAVE_BROWSER_SCREENSHOTS === "1" ? "docs/screenshots" : "test-results";
  const outputPath = path.resolve(process.cwd(), outputDirectory, filename);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ fullPage, path: outputPath });
}

test("fresh-owner transaction flow with transfers, adjustments, audit, reports, and mobile layout", async ({ page, browser }) => {
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No transactions yet" })).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account name").fill("Browser cash account");
  await page.getByLabel("Account type").selectOption("cash");
  await page.getByLabel("Opening balance").fill("100000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]+\?created=1$/);

  await page.goto("/accounts/new");
  await page.getByLabel("Account name").fill("Browser investment account");
  await page.getByLabel("Account type").selectOption("investment");
  await page.getByLabel("Currency code").selectOption("JPY");
  await page.getByLabel("Opening balance").fill("50000");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]+\?created=1$/);

  await page.goto("/accounts/new");
  await page.getByLabel("Account name").fill("Browser VND account");
  await page.getByLabel("Account type").selectOption("cash");
  await page.getByLabel("Currency code").selectOption("VND");
  await page.getByLabel("Opening balance").fill("0");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]+\?created=1$/);

  await page.goto("/");
  const accountBalances = page.getByRole("region", { name: "Account balances" });
  await expect(accountBalances.getByText("¥100,000", { exact: true })).toBeVisible();
  await expect(page.getByText("No income recorded", { exact: true })).toBeVisible();
  await expect(page.getByText("No expense recorded", { exact: true })).toBeVisible();

  await page.goto("/transactions/new");
  await expect(page.getByRole("heading", { name: "Add an expense category first" })).toBeVisible();
  await page.getByRole("link", { name: "Create a category" }).click();

  await page.getByLabel("Category name").fill("Food");
  await page.getByRole("button", { name: "Add category" }).click();
  const foodRow = page.locator("li").filter({ hasText: "Food" }).first();
  await expect(foodRow.getByText("Food", { exact: true })).toBeVisible();

  await page.getByLabel("Category name").fill("Transport");
  await page.getByRole("button", { name: "Add category" }).click();
  const transportRow = page.locator("li").filter({ hasText: "Transport" }).first();
  await expect(transportRow.getByText("Transport", { exact: true })).toBeVisible();

  await page.getByLabel("Kind").selectOption("income");
  await page.getByLabel("Category name").fill("Salary");
  await page.getByRole("button", { name: "Add category" }).click();
  const salaryRow = page.locator("li").filter({ hasText: "Salary" }).first();
  await expect(salaryRow.getByText("Salary", { exact: true })).toBeVisible();

  await page.getByLabel("Rename Transport").fill("Transit");
  await transportRow.getByRole("button", { name: "Rename" }).click();
  await expect(page).toHaveURL(/categorySaved=1$/);
  const transitRow = page.locator("li").filter({ hasText: "Transit" }).first();
  await expect(transitRow.getByText("Transit", { exact: true })).toBeVisible();

  await page.getByLabel("Method type").selectOption("cash");
  await page.getByLabel("Method name").fill("Pocket cash");
  await page.getByLabel("Linked bank or cash account").selectOption({ label: "Browser cash account · JPY" });
  await page.getByRole("button", { name: "Add payment method" }).click();
  await expect(page).toHaveURL(/methodCreated=1$/);
  await expect(page.getByText("Pocket cash", { exact: true })).toBeVisible();

  await page.goto("/transactions/new?kind=expense");
  await page.getByLabel("Amount").fill("1200");
  const economicDate = await page.getByLabel("Transaction date").inputValue();
  await page.getByLabel("Category").selectOption({ label: "Food" });
  await page.getByLabel("Payment method and account").selectOption({ label: "Pocket cash · cash · Browser cash account" });
  await page.getByLabel(/Merchant or source/).fill("Lunch");
  await page.getByLabel(/^Note/).fill("Synthetic browser smoke entry");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?created=1$/);
  const originalUrl = page.url();
  await expect(page.getByRole("status")).toContainText("Transaction posted.");
  await expect(page.getByRole("heading", { name: "Lunch" })).toBeVisible();
  await expect(page.getByText("Original currency amount", { exact: true })).toBeVisible();
  await expect(page.getByText("−¥1,200", { exact: true })).toBeVisible();
  await expect(page.getByText("Economic date", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Effective time ·/)).toHaveCount(0);
  await expect(page.getByText(/^Recorded at ·/)).toBeVisible();

  await page.goto("/");
  const spending = page.getByRole("region", { name: "Spending this month by currency" });
  await expect(spending.getByText("JPY · 1 event", { exact: true })).toBeVisible();
  await expect(spending.getByText("¥1,200", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account balances" }).getByText("¥98,800", { exact: true })).toBeVisible();

  await page.goto("/transactions/categories");
  const foodCategory = page.locator("li").filter({ hasText: "Food" }).first();
  await foodCategory.getByRole("checkbox").check();
  await foodCategory.getByRole("button", { name: "Archive" }).click();
  await expect(page).toHaveURL(/categoryArchived=1$/);
  await expect(foodCategory.getByText("Archived", { exact: true })).toBeVisible();

  await page.goto(originalUrl);
  await page.getByRole("link", { name: "Edit transaction" }).click();
  await page.getByLabel("Amount").fill("1500");
  await page.getByLabel("Category").selectOption({ label: "Transit" });
  await page.getByLabel("Why is this being corrected?").fill("Corrected amount and category");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?corrected=1$/);
  const replacementUrl = page.url();
  await expect(page.getByRole("status")).toContainText("Correction saved.");
  await expect(page.getByText("−¥1,500", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Spending this month by currency" }).getByText("¥1,500", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account balances" }).getByText("¥98,500", { exact: true })).toBeVisible();

  await page.goto(originalUrl);
  await expect(page.getByText("Voided · corrected", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Correction audit" })).toBeVisible();
  await expect(page.getByText("Corrected amount and category", { exact: true })).toBeVisible();

  await page.goto(replacementUrl);
  await page.getByLabel("Reason for voiding").fill("Synthetic standalone void smoke test");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Void transaction" }).click();
  await expect(page).toHaveURL(/\?voided=1$/);
  await expect(page.getByRole("status")).toContainText("Transaction voided.");

  await page.goto("/");
  const recentActivity = page.getByRole("region", { name: "Recent activity" });
  await expect(recentActivity.getByRole("heading", { name: "No transactions yet" })).toBeVisible();
  await expect(recentActivity.getByRole("link", { name: /Lunch/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Spending this month by currency" }).getByText("No expense recorded", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account balances" }).getByText("¥100,000", { exact: true })).toBeVisible();

  await page.goto("/transactions/new?kind=income");
  await page.getByLabel("Amount").fill("5000");
  await page.getByLabel("Category").selectOption({ label: "Salary" });
  await page.getByLabel("Payment method and account").selectOption({ label: "Pocket cash · cash · Browser cash account" });
  await page.getByLabel(/Merchant or source/).fill("Salary");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?created=1$/);

  await page.goto("/");
  const income = page.getByRole("region", { name: "Income this month by currency" });
  await expect(income.getByText("JPY · 1 event", { exact: true })).toBeVisible();
  await expect(income.getByText("¥5,000", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account balances" }).getByText("¥105,000", { exact: true })).toBeVisible();

  await page.goto("/transactions");
  await page.getByLabel("Search").fill("Lunch");
  await page.getByLabel("Type").selectOption("expense");
  await page.getByLabel("Status").selectOption("voided");
  await page.getByLabel("From").fill(economicDate);
  await page.getByLabel("Through").fill(economicDate);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/2 transactions · newest economic date first/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Lunch/ })).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Lunch Food .*Voided · corrected/ })).toBeVisible();
  await capture(page, "issue-5-transactions-desktop.png");
  await page.goto("/transactions/categories");
  await page.getByLabel("Method type").selectOption("credit_card");
  await page.getByLabel("Method name").fill("Travel card");
  await expect(page.getByLabel("Linked bank or cash account")).toBeDisabled();
  await page.getByRole("button", { name: "Add payment method" }).click();
  await expect(page).toHaveURL(/methodCreated=1$/);
  await expect(page.getByText("Travel card", { exact: true })).toBeVisible();

  await page.goto("/transactions/new?kind=expense");
  await page.getByLabel("Amount").fill("10000");
  const cardDate = await page.getByLabel("Transaction date").inputValue();
  const futureSettlementDate = new Date(`${cardDate}T00:00:00.000Z`);
  futureSettlementDate.setUTCDate(futureSettlementDate.getUTCDate() + 1);
  const futurePaymentDate = futureSettlementDate.toISOString().slice(0, 10);
  await page.getByLabel("Category").selectOption({ label: "Transit" });
  await page.getByLabel("Payment method and account").selectOption({ label: "Travel card · credit card" });
  await page.getByLabel(/Merchant or source/).fill("Card purchase");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?created=1$/);
  await expect(page.getByText("−¥10,000", { exact: true })).toBeVisible();
  await expect(page.getByText("Credit-card expense · no account movement", { exact: true })).toBeVisible();

  await page.goto("/");
  const cardSpending = page.getByRole("region", { name: "Spending this month by currency" });
  await expect(cardSpending.getByText("JPY · 1 event", { exact: true })).toBeVisible();
  await expect(cardSpending.getByText("¥10,000", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account balances" }).getByText("¥105,000", { exact: true })).toBeVisible();

  await page.goto("/transactions/settlement");
  await expect(page.getByRole("heading", { name: "Settle a credit card" })).toBeVisible();
  await page.getByLabel("Settlement amount").fill("10000");
  await page.getByLabel("Credit card").selectOption({ label: "Travel card" });
  await page.getByLabel("Pay from funded account").selectOption({ label: "Browser cash account · cash · JPY" });
  await page.getByLabel("Payment date").fill(futurePaymentDate);
  await page.getByLabel(/Note/).fill("Card payment");
  await expect(page.getByText(/Faylo does not track outstanding card balances/)).toBeVisible();
  await capture(page, "issue-6-card-settlement-desktop.png");
  await page.getByRole("button", { name: "Record card settlement" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?settled=1$/);
  await expect(page.getByRole("status")).toHaveText("Card settlement recorded. The selected account balance reflects it from the payment date; spending totals are unchanged.");
  await expect(page.getByText("Paid from Browser cash account · one debit in JPY", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Spending this month by currency" }).getByText("¥10,000", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account balances" }).getByText("¥105,000", { exact: true })).toBeVisible();
  await page.goto("/transactions");
  await page.getByLabel("Search").fill("Travel card");
  await page.getByLabel("Type").selectOption("card_settlement");
  await page.getByLabel("Status").selectOption("posted");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: /Card settlement/ })).toHaveCount(1);

  await page.goto("/transactions/transfer");
  await page.getByLabel("From account").selectOption({ label: "Browser cash account · cash · JPY" });
  await page.getByLabel("To account").selectOption({ label: "Browser investment account · investment · JPY" });
  await page.getByLabel("Amount sent").fill("3000");
  await page.getByLabel("Amount received").fill("2999");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByText("Same-currency transfers must send and receive the same amount.", { exact: true })).toBeVisible();
  await page.getByLabel("Amount received").fill("3000");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByRole("heading", { name: "Review transfer" })).toBeVisible();
  await expect(page.getByText("From · Browser cash account", { exact: true })).toBeVisible();
  await expect(page.getByText("To · Browser investment account", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and post transfer" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and post transfer" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?transferred=1$/);
  const sameCurrencyTransferUrl = page.url();
  await expect(page.getByRole("heading", { name: "Browser cash account → Browser investment account" })).toBeVisible();
  await expect(page.getByText("Amounts sent and received", { exact: true })).toBeVisible();
  await expect(page.getByText("−¥3,000", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("+¥3,000", { exact: true }).first()).toBeVisible();

  await page.getByLabel("Reason for voiding").fill("Synthetic transfer reversal");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Void transaction" }).click();
  await expect(page).toHaveURL(/\?voided=1$/);
  await expect(page.getByRole("heading", { name: "Voiding audit" })).toBeVisible();
  await expect(page.getByText("Synthetic transfer reversal", { exact: true })).toBeVisible();
  await page.goto(sameCurrencyTransferUrl);
  await expect(page.getByText("Voided", { exact: true }).first()).toBeVisible();

  await page.goto("/transactions/transfer");
  await page.getByLabel("From account").selectOption({ label: "Browser cash account · cash · JPY" });
  await page.getByLabel("To account").selectOption({ label: "Browser VND account · cash · VND" });
  await page.getByLabel("Amount sent").fill("1000");
  await page.getByLabel("Amount received").fill("180000");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByText(/Actual amounts in JPY and VND/)).toBeVisible();
  await expect(page.getByText(/No exchange rate is inferred or recorded/)).toBeVisible();
  await capture(page, "issue-7-transfer-desktop.png");
  await page.getByRole("button", { name: "Confirm and post transfer" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?transferred=1$/);
  await expect(page.getByText("−¥1,000", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("+₫180,000", { exact: true }).first()).toBeVisible();

  await page.goto("/transactions/adjustment");
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "Browser VND account · cash · VND" });
  await page.getByLabel("Signed amount").fill("100");
  await page.getByLabel("Why is the balance changing?").fill("Synthetic VND reconciliation");
  await page.getByRole("button", { name: "Review adjustment" }).click();
  await expect(page.getByRole("heading", { name: "Review balance adjustment" })).toBeVisible();
  await expect(page.getByText("+₫100", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and post adjustment" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?adjusted=1$/);
  await expect(page.getByRole("heading", { name: "Adjustment explanation" })).toBeVisible();
  await expect(page.getByText("Synthetic VND reconciliation", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Income this month by currency" }).getByText("¥5,000", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Spending this month by currency" }).getByText("¥10,000", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Account balances" }).getByText("₫180,100", { exact: true })).toBeVisible();

  await page.goto("/transactions");
  await page.getByLabel("Search").fill("Browser cash account");
  await page.getByLabel("Type").selectOption("transfer");
  await page.getByLabel("Status").selectOption("posted");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: /Browser cash account → Browser VND account/ })).toHaveCount(1);

  await page.goto("/transactions");
  await page.getByLabel("Search").fill("Synthetic VND reconciliation");
  await page.getByLabel("Type").selectOption("balance_adjustment");
  await page.getByLabel("Status").selectOption("posted");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: /Balance adjustment/ })).toHaveCount(1);
  await page.goto("/transactions/transfer");
  await page.getByLabel("From account").selectOption({ label: "Browser cash account · cash · JPY" });
  await page.getByLabel("To account").selectOption({ label: "Browser VND account · cash · VND" });
  await page.getByLabel("Amount sent").fill("2500");
  await page.getByLabel("Amount received").fill("450000");
  await page.getByLabel("Economic date").fill(futurePaymentDate);
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByRole("heading", { name: "Review transfer" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and post transfer" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?transferred=1$/);
  await expect(page.getByText(/^Effective time ·/)).toHaveCount(0);
  await expect(page.getByText(/^Recorded at ·/)).toBeVisible();

  await page.goto("/transactions/adjustment");
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "Browser VND account · cash · VND" });
  await page.getByLabel("Signed amount").fill("350");
  await page.getByLabel("Economic date").fill(futurePaymentDate);
  await page.getByLabel("Why is the balance changing?").fill("Synthetic future-effective adjustment");
  await page.getByRole("button", { name: "Review adjustment" }).click();
  await expect(page.getByRole("heading", { name: "Review balance adjustment" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and post adjustment" }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\?adjusted=1$/);

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Income this month by currency" }).getByText("¥5,000", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Spending this month by currency" }).getByText("¥10,000", { exact: true })).toBeVisible();
  const todayBalances = page.getByRole("region", { name: "Account balances" });
  await expect(todayBalances.getByText("¥104,000", { exact: true })).toBeVisible();
  await expect(todayBalances.getByText("₫180,100", { exact: true })).toBeVisible();


  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    storageState: path.resolve(process.cwd(), AUTH_STATE_PATH),
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto("/transactions");
  await mobile.getByLabel("Search").fill("Salary");
  await mobile.getByLabel("Type").selectOption("income");
  await mobile.getByLabel("Status").selectOption("posted");
  await mobile.getByLabel("From").fill(economicDate);
  await mobile.getByLabel("Through").fill(economicDate);
  await mobile.getByRole("button", { name: "Apply" }).click();
  await expect(mobile.getByRole("link", { name: /Salary/ })).toHaveCount(1);
  const dimensions = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.viewportWidth, `mobile layout overflows by ${dimensions.scrollWidth - dimensions.viewportWidth}px`);
  await mobile.getByRole("region", { name: "Transaction history" }).scrollIntoViewIfNeeded();
  await capture(mobile, "issue-5-transactions-mobile.png", false);

  await mobile.getByLabel("Search").fill("no matching synthetic transaction");
  await mobile.getByRole("button", { name: "Apply" }).click();
  await expect(mobile.getByRole("heading", { name: "No matching transactions" })).toBeVisible();
  await mobile.goto("/transactions/settlement");
  await mobile.getByLabel("Settlement amount").fill("10000");
  await mobile.getByLabel("Credit card").selectOption({ label: "Travel card" });
  await mobile.getByLabel("Pay from funded account").selectOption({ label: "Browser cash account · cash · JPY" });
  await mobile.getByLabel("Payment date").fill(cardDate);
  await mobile.getByLabel(/Note/).fill("Card payment");
  await expect(mobile.getByText(/Faylo does not track outstanding card balances/)).toBeVisible();
  const settlementDimensions = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  assert.ok(settlementDimensions.scrollWidth <= settlementDimensions.viewportWidth, `mobile settlement layout overflows by ${settlementDimensions.scrollWidth - settlementDimensions.viewportWidth}px`);
  await mobile.setViewportSize({ width: 390, height: 1600 });
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await capture(mobile, "issue-6-card-settlement-mobile.png", false);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto("/transactions/adjustment");
  await mobile.getByLabel("Account", { exact: true }).selectOption({ label: "Browser investment account · investment · JPY" });
  await mobile.getByLabel("Signed amount").fill("-250");
  await mobile.getByLabel("Why is the balance changing?").fill("Synthetic mobile balance reconciliation");
  await mobile.getByRole("button", { name: "Review adjustment" }).click();
  await expect(mobile.getByRole("heading", { name: "Review balance adjustment" })).toBeVisible();
  await expect(mobile.getByText("−¥250", { exact: true })).toBeVisible();
  const movementDimensions = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  assert.ok(movementDimensions.scrollWidth <= movementDimensions.viewportWidth, `mobile adjustment layout overflows by ${movementDimensions.scrollWidth - movementDimensions.viewportWidth}px`);
  await mobile.setViewportSize({ width: 390, height: 1600 });
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await capture(mobile, "issue-7-adjustment-mobile.png");
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.getByRole("button", { name: "Confirm and post adjustment" }).click();
  await expect(mobile).toHaveURL(/\/transactions\/[0-9a-f-]+\?adjusted=1$/);
  await expect(mobile.getByText("−¥250", { exact: true }).first()).toBeVisible();
  await mobileContext.close();
});
