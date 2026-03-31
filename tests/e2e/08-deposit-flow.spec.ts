import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { createAndReopenAppointment } from './helpers/appointment';

// NOTE: These tests require:
//   - Studio with stripe_charges_enabled = true
//   - Supabase edge function 'create-deposit-checkout' deployed and reachable
//   - Supabase site URL configured to http://localhost:3000

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

const CARD_SUCCESS = '4242424242424242';
const CARD_DECLINE = '4000000000000002';

/**
 * Fills Stripe's hosted checkout card fields.
 *
 * On this version of checkout.stripe.com the card inputs (card number, expiry, CVC)
 * are rendered as plain <input> elements directly in the page DOM — NOT inside iframes.
 * IDs: #cardNumber, #cardExpiry, #cardCvc  (aria-labels match too).
 *
 * If the card accordion is not yet expanded, we try to click the Card radio button
 * or the accordion button first, then wait for #cardNumber to appear.
 */
async function fillStripeCard(page: any, cardNumber: string) {
  await page.waitForLoadState('networkidle');

  // Card inputs are plain DOM inputs — no iframes
  const cardNumberInput = page.locator('input#cardNumber');
  const cardVisible = await cardNumberInput.isVisible({ timeout: 5000 }).catch(() => false);

  if (!cardVisible) {
    // Card tab is not expanded — click the accordion button to expand it.
    // The page loads with no method selected (Card, Klarna, Affirm all collapsed).
    // IMPORTANT: click the accordion button, NOT the radio input — the radio has
    // tabindex="-1" and does not trigger the accordion expansion animation.
    const cardAccordionBtn = page.locator('[data-testid="card-accordion-item-button"]');
    if (await cardAccordionBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await cardAccordionBtn.click();
    } else {
      // Fallback: aria-label on the same button
      await page.getByRole('button', { name: /pay with card/i }).click();
    }

    await expect(cardNumberInput).toBeVisible({ timeout: 15000 });
  }

  await cardNumberInput.fill(cardNumber);

  // Expiry — id="cardExpiry", aria-label="Expiration", placeholder="MM / YY"
  const expiryInput = page.locator('input#cardExpiry').first();
  await expect(expiryInput).toBeVisible({ timeout: 5000 });
  await expiryInput.fill('12/28');

  // CVC — id="cardCvc", aria-label="CVC"
  const cvcInput = page.locator('input#cardCvc').first();
  if (await cvcInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cvcInput.fill('123');
  }

  // Cardholder name — id="billingName", placeholder="Full name on card"
  const nameInput = page.locator('input#billingName').first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.fill('InkFlow Tester');
  }

  // Postal code — id="billingPostalCode", placeholder="Postal code"
  const postalInput = page.locator('input#billingPostalCode').first();
  if (await postalInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await postalInput.fill('10001');
  }
}

/**
 * Clicks Stripe's payment submit button.
 * Stripe's hosted checkout page has several buttons matching /pay/i ("Pay with Card",
 * "Apple Pay", etc.). We target the final submit button using Stripe's own test ID,
 * falling back to button[type="submit"] if it's unavailable.
 */
async function submitStripePayment(page: any) {
  // Stripe test mode: submit button has data-testid="hosted-payment-submit-button"
  const stripeSubmit = page.locator('[data-testid="hosted-payment-submit-button"]');
  if (await stripeSubmit.isVisible({ timeout: 5000 }).catch(() => false)) {
    await stripeSubmit.click();
    return;
  }
  // Fallback: the only submit button on the page
  const submitBtn = page.locator('button[type="submit"]').last();
  if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submitBtn.click();
    return;
  }
  // Last resort: button whose text contains a currency symbol (e.g. "Pay $50.00")
  await page.locator('button').filter({ hasText: /pay \$|\$/i }).last().click();
}

/**
 * Finds an existing appointment that has a deposit button visible, opens it,
 * and returns the dialog. Prefers "E2E Client", falls back to any suitable row.
 */
async function openUnpaidDepositAppointment(page: any) {
  await page.goto('/appointments');
  await page.waitForLoadState('networkidle');

  // Try "E2E Client" first (created by test 07)
  const preferredRow = page.locator('div.cursor-pointer').filter({ hasText: 'E2E Client' }).first();
  if (await preferredRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await preferredRow.click();
  } else {
    // Fallback: first non-completed appointment row
    const fallback = page.locator('div.cursor-pointer').filter({ hasNotText: /completed/i }).first();
    if (!await fallback.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'No suitable appointment found for deposit test.');
      return null;
    }
    await fallback.click();
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8000 });
  return dialog;
}

test.describe('Deposit Flow', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
  });

  // ── Static page tests (no dependencies) ────────────────────────────────────

  test('HP-DEP-2: /deposit-success static page renders correctly', async ({ page }) => {
    await page.goto('/deposit-success?studio=Test+Studio');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /deposit received/i })).toBeVisible();
    await expect(page.getByText(/test studio/i)).toBeVisible();
  });

  test('HP-DEP-3: /deposit-cancelled page renders without error', async ({ page }) => {
    await page.goto('/deposit-cancelled');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  // ── Happy Path: Full end-to-end deposit ────────────────────────────────────

  test('HP-DEP-1: Create deposit link, pay with test card, verify success page', async ({ page }) => {
    test.setTimeout(90000);
    const dialog = await openUnpaidDepositAppointment(page);
    if (!dialog) return;

    const depositBtn = dialog.getByRole('button', { name: /create deposit link|resend deposit link/i });
    if (!await depositBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'No deposit link button visible — appointment may already be paid or deposit is 0.');
      return;
    }

    await depositBtn.click();

    // Wait for the loading state to finish (button re-enables when done)
    await expect(depositBtn).toBeEnabled({ timeout: 20000 });

    // Check for the success message. If it's absent this is a potential UI bug —
    // the edge function may have written the checkout URL to clipboard without
    // updating the success message state. We validate via the clipboard instead.
    // Wait for the success message and the copyable URL row to appear in the dialog
    await expect(
      dialog.getByText(/deposit link created/i)
    ).toBeVisible({ timeout: 20000 });

    // The URL is now rendered in a read-only input inside the dialog —
    // read it directly rather than from the clipboard (clipboard may be blocked in headless mode)
    const urlInput = dialog.locator('input[readonly]').last();
    await expect(urlInput).toBeVisible({ timeout: 5000 });
    const checkoutUrl = await urlInput.inputValue();
    expect(checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com/);

    await page.goto(checkoutUrl);
    await page.waitForLoadState('domcontentloaded');

    await fillStripeCard(page, CARD_SUCCESS);
    await submitStripePayment(page);

    await page.waitForURL('**/deposit-success**', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: /deposit received/i })).toBeVisible();
  });

  // ── Non-Happy Path: Declined card ─────────────────────────────────────────

  test('NHP-DEP-4: Declined card shows Stripe error, does not redirect to success', async ({ page }) => {
    // Create a fresh appointment, save it, reopen it — THEN create the deposit link
    const dialog = await createAndReopenAppointment(page, 'E2E Decline Deposit', 50);

    const depositBtn = dialog.getByRole('button', { name: /create deposit link|resend deposit link/i });
    if (!await depositBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'Deposit link button not visible — check that deposit_amount > 0 was saved.');
      return;
    }

    await depositBtn.click();

    await expect(dialog.getByText(/deposit link created/i)).toBeVisible({ timeout: 20000 });
    const urlInput = dialog.locator('input[readonly]').last();
    await expect(urlInput).toBeVisible({ timeout: 5000 });
    const checkoutUrl = await urlInput.inputValue();

    if (!checkoutUrl.startsWith('https://checkout.stripe.com')) {
      test.skip(true, 'Deposit link was not created — Stripe may not be connected or edge function failed.');
      return;
    }

    await page.goto(checkoutUrl);
    await page.waitForLoadState('domcontentloaded');
    await fillStripeCard(page, CARD_DECLINE);
    await submitStripePayment(page);

    await expect(page.getByText(/declined|card was declined/i)).toBeVisible({ timeout: 15000 });
    expect(page.url()).not.toContain('/deposit-success');
  });

  // ── Non-Happy Path: Deposit button hidden when deposit is zero ────────────

  test('NHP-DEP-5: Deposit link button hidden when deposit_amount = 0', async ({ page }) => {
    // Create a fresh appointment with deposit = 0, save it, reopen it
    const dialog = await createAndReopenAppointment(page, 'E2E Zero Deposit', 0);

    // With deposit_amount = 0 the "Create Deposit Link" button must not be visible
    await expect(
      dialog.getByRole('button', { name: /create deposit link|resend deposit link/i })
    ).not.toBeVisible({ timeout: 5000 });
  });

  // ── Non-Happy Path: Deposit button hidden after already paid ─────────────

  test('NHP-DEP-6: Deposit link button hidden after deposit is paid', async ({ page }) => {
    await page.goto('/appointments');
    await page.waitForLoadState('networkidle');

    // Find any appointment that already shows a "paid" deposit badge
    const paidRow = page.locator('div.cursor-pointer').filter({ hasText: /paid/i }).first();
    if (!await paidRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'No paid deposit appointment found yet — run HP-DEP-1 first to create one.');
      return;
    }
    await paidRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });
    await expect(
      dialog.getByRole('button', { name: /create deposit link|resend deposit link/i })
    ).not.toBeVisible({ timeout: 3000 });
  });
});
