import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

// Use a unique suffix per run so re-runs don't hit the duplicate detection dialog
const RUN_ID = Date.now();
const CUSTOMER_NAME = `Test Customer E2E`;
const CUSTOMER_PHONE = `555-${String(RUN_ID).slice(-4)}`;

/** Clicks the clickable card div (not just the inner text) to reliably trigger the onClick handler */
async function clickCustomerCard(page: any, nameText: string) {
  // Target the div with cursor-pointer class that wraps the customer row
  const card = page.locator('div.cursor-pointer').filter({ hasText: nameText }).first();
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();
}

/** If a duplicate detection dialog pops up, click "Create Anyway" to proceed */
async function handleDuplicateDialog(page: any) {
  const duplicateAlert = page.getByRole('alertdialog').filter({ hasText: /duplicate/i });
  const appeared = await duplicateAlert.isVisible().catch(() => false);
  if (appeared) {
    await duplicateAlert.getByRole('button', { name: /create anyway/i }).click();
    await expect(duplicateAlert).not.toBeVisible({ timeout: 5000 });
  }
}

test.describe('Customers', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-CUST-1: /customers loads with search input visible', async ({ page }) => {
    await expect(page.getByPlaceholder(/search/i)).toBeVisible({ timeout: 10000 });
  });

  test('HP-CUST-2: Add Customer button opens CustomerDialog', async ({ page }) => {
    await page.getByRole('button', { name: /add customer|new customer/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
  });

  test('HP-CUST-3: Create a new customer and verify they appear in the list', async ({ page }) => {
    await page.getByRole('button', { name: /add customer|new customer/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Use #name directly — getByLabel(/name/i) would also match "Phone Number *"
    await dialog.locator('#name').fill(CUSTOMER_NAME);

    // phone_number is required
    await dialog.getByLabel(/phone number/i).fill(CUSTOMER_PHONE);
    await dialog.getByLabel(/email/i).fill('testcustomer@example.com');

    await dialog.getByRole('button', { name: /create/i }).click();

    // Handle duplicate detection if it appears (re-runs of the test suite)
    await page.waitForTimeout(800);
    await handleDuplicateDialog(page);

    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(CUSTOMER_NAME).first()).toBeVisible({ timeout: 10000 });
  });

  test('HP-CUST-4: Clicking a customer card opens dialog in edit mode with pre-filled data', async ({ page }) => {
    await clickCustomerCard(page, CUSTOMER_NAME);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Verify the dialog opened in edit mode with the name pre-filled.
    // We check non-empty rather than an exact value because a prior test run
    // may have already renamed this customer (HP-CUST-5 appends " Updated").
    const nameField = dialog.locator('#name');
    await expect(nameField).toBeVisible({ timeout: 5000 });
    const prefilled = await nameField.inputValue();
    expect(prefilled.trim().length).toBeGreaterThan(0);
  });

  test('HP-CUST-5: Edit customer name and verify update in list', async ({ page }) => {
    await clickCustomerCard(page, CUSTOMER_NAME);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    const nameField = dialog.locator('#name');
    await nameField.clear();
    await nameField.fill(`${CUSTOMER_NAME} Updated`);

    await dialog.getByRole('button', { name: /update/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(`${CUSTOMER_NAME} Updated`).first()).toBeVisible({ timeout: 10000 });
  });

  test('HP-CUST-6: Search input filters customer list in real time', async ({ page }) => {
    await page.getByPlaceholder(/search/i).fill('E2E');
    await page.waitForTimeout(500);
    // At least one E2E customer should be visible
    await expect(page.getByText(/test customer e2e/i).first()).toBeVisible();
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-CUST-7: Save customer with no name is blocked', async ({ page }) => {
    await page.getByRole('button', { name: /add customer|new customer/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Phone is also required — fill it but leave name empty
    await dialog.getByLabel(/phone number/i).fill('555-0000');

    const saveBtn = dialog.getByRole('button', { name: /create/i });
    await saveBtn.click();

    // Dialog should stay open (HTML5 required validation blocks submission)
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });
});
