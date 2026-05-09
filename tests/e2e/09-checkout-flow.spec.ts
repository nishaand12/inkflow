import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { createAndReopenAppointment } from './helpers/appointment';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

/**
 * Opens the CheckoutDialog for an existing appointment.
 * Prefers "E2E Client", falls back to any non-completed appointment row.
 */
async function openCheckoutDialog(page: any) {
  await page.goto('/appointments');
  await page.waitForLoadState('networkidle');

  const preferredRow = page.locator('div.cursor-pointer').filter({ hasText: 'E2E Client' }).first();
  if (await preferredRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await preferredRow.click();
  } else {
    const fallback = page.locator('div.cursor-pointer').filter({ hasNotText: /completed/i }).first();
    if (!await fallback.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'No suitable appointment found for checkout test.');
      return null;
    }
    await fallback.click();
  }

  const apptDialog = page.getByRole('dialog');
  await expect(apptDialog).toBeVisible({ timeout: 8000 });

  const checkoutBtn = apptDialog.getByRole('button', { name: /check.?out/i });
  if (!await checkoutBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    test.skip(true, 'Check Out button not available — appointment may already be completed.');
    return null;
  }
  await checkoutBtn.click();

  await page.waitForTimeout(500);
  const checkoutDialog = page.getByRole('dialog').filter({ hasText: /check out appointment/i });
  await expect(checkoutDialog).toBeVisible({ timeout: 8000 });
  return checkoutDialog;
}

test.describe('Checkout / Payment Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
  });

  // ── Static page tests (no dependencies) ────────────────────────────────────

  test('HP-CHK-3: /payment-success with type=payment shows "Payment Successful!"', async ({ page }) => {
    await page.goto('/payment-success?studio=Test+Studio&type=payment');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /payment successful/i })).toBeVisible();
  });

  test('HP-CHK-4: /payment-success with type=deposit shows "Appointment confirmed!"', async ({ page }) => {
    await page.goto('/payment-success?studio=Test+Studio&type=deposit');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();
  });

  test('HP-CHK-5: /payment-cancelled page renders without error', async ({ page }) => {
    await page.goto('/payment-cancelled');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  // ── Non-Happy Path: Zero charge ───────────────────────────────────────────

  test('NHP-CHK-6: (removed) Stripe zero-charge — checkout UI is manual / in-person only', async () => {
    test.skip(true, 'Stripe checkout was removed from CheckoutDialog.');
  });

  // ── Happy Path: Manual checkout ───────────────────────────────────────────

  test('HP-CHK-2: Manual checkout marks appointment as completed', async ({ page }) => {
    // Create a fresh appointment, save it, reopen it — THEN open checkout
    const apptDialog = await createAndReopenAppointment(page, 'E2E Manual Checkout');

    const checkoutBtn = apptDialog.getByRole('button', { name: /check.?out/i });
    await expect(checkoutBtn).toBeVisible({ timeout: 5000 });
    await checkoutBtn.click();

    const checkoutDialog = page.getByRole('dialog').filter({ hasText: /check out appointment/i });
    await expect(checkoutDialog).toBeVisible({ timeout: 8000 });

    const noLineItems = await checkoutDialog.getByText(/no line items/i).isVisible({ timeout: 2000 }).catch(() => false);
    if (noLineItems) {
      await checkoutDialog.getByRole('button', { name: /add item/i }).click();
      await checkoutDialog.getByPlaceholder('Item description').fill('E2E service');
      await checkoutDialog.locator('input[placeholder="0.00"]').first().fill('150.00');
      await checkoutDialog.getByRole('button', { name: /^add$/i }).click();
    } else {
      await checkoutDialog.locator('tbody tr').first().locator('input[type="number"]').nth(1).fill('150.00');
    }

    // Select "Cash" as payment method
    const payMethodTrigger = checkoutDialog.getByRole('combobox').last();
    await payMethodTrigger.click();
    await page.getByRole('option', { name: /cash/i }).click();

    await checkoutDialog.getByRole('button', { name: /manual checkout/i }).click();
    await expect(checkoutDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('HP-CHK-1: (removed) Stripe hosted checkout — UI is manual / in-person only', async () => {
    test.skip(true, 'Stripe checkout was removed from CheckoutDialog.');
  });

  test('NHP-CHK-7: (removed) Declined Stripe card — UI is manual / in-person only', async () => {
    test.skip(true, 'Stripe checkout was removed from CheckoutDialog.');
  });
});
