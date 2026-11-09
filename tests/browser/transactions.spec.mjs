import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { AUTH_STATE_PATH } from "./constants.mjs";

async function capture(page, filename, fullPage = true) {
  const outputDirectory = process.env.SAVE_BROWSER_SCREENSHOTS === "1" ? "docs/screenshots" : "test-results";
  const outputPath = path.resolve(process.cwd(), outputDirectory, filename);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ fullPage, path: outputPath });
}

test("fresh-owner transaction flow, correction, void, balances, filters, and mobile layout", async ({ page, browser }) => {
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No transactions yet" })).toBeVisible();

  await page.goto("/accounts/new");
  await page.getByLabel("Account name").fill("Browser cash account");
  await page.getByLabel("Account type").selectOption("cash");
  await page.getByLabel("Opening balance").fill("100000");
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
  await mobileContext.close();
});
