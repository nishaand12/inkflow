import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { createAndReopenAppointment } from './helpers/appointment';

// NOTE: These tests require:
//   - Studio with stripe_charges_enabled = true
//   - Supabase edge function 'create-checkout-payment' deployed and reachable

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

const CARD_SUCCESS = '4242424242424242';
const CARD_DECLINE = '4000000000000002';

/**
 * Fills Stripe's hosted checkout card fields.
 *
 * On this version of checkout.stripe.com the card inputs are plain <input> elements
 * rendered directly in the page DOM — NOT inside iframes.
 * IDs: #cardNumber, #cardExpiry, #cardCvc, #billingName, #billingPostalCode
 *
 * If the card accordion is not yet expanded, we click the Card radio/accordion button
 * first, then wait for #cardNumber to become visible.
 */
async function fillStripeCard(page: any, cardNumber: string) {
  await page.waitForLoadState('networkidle');

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
 * Stripe's checkout page has multiple buttons matching /pay/i. We target the
 * authoritative submit button using Stripe's own data-testid first, then fall back.
 */
async function submitStripePayment(page: any) {
  const stripeSubmit = page.locator('[data-testid="hosted-payment-submit-button"]');
  if (await stripeSubmit.isVisible({ timeout: 5000 }).catch(() => false)) {
    await stripeSubmit.click();
    return;
  }
  const submitBtn = page.locator('button[type="submit"]').last();
  if (await submitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submitBtn.click();
    return;
  }
  await page.locator('button').filter({ hasText: /pay \$|\$/i }).last().click();
}

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

  test('HP-CHK-4: /payment-success with type=deposit shows "Deposit Received!"', async ({ page }) => {
    await page.goto('/payment-success?studio=Test+Studio&type=deposit');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: /deposit received/i })).toBeVisible();
  });

  test('HP-CHK-5: /payment-cancelled page renders without error', async ({ page }) => {
    await page.goto('/payment-cancelled');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toBeEmpty();
  });

  // ── Non-Happy Path: Zero charge ───────────────────────────────────────────

  test('NHP-CHK-6: Stripe checkout with zero charge shows error, dialog stays open', async ({ page }) => {
    const dialog = await openCheckoutDialog(page);
    if (!dialog) return;

    const stripeBtn = dialog.getByRole('button', { name: /check out via stripe/i });
    if (!await stripeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'Check Out via Stripe button not visible — Stripe may not be connected.');
      return;
    }

    // Explicitly set charge_amount to 0 — the dialog pre-populates from total_estimate
    // which may be > 0 for the picked appointment, so we must override it.
    const chargeField = dialog.locator('#charge_amount');
    if (await chargeField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chargeField.clear();
      await chargeField.fill('0');
    }

    await stripeBtn.click();
    await expect(dialog.getByText(/greater than 0/i)).toBeVisible({ timeout: 8000 });
    await expect(dialog).toBeVisible();
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

    await checkoutDialog.locator('#charge_amount').fill('150.00');

    // Select "Cash" as payment method
    const payMethodTrigger = checkoutDialog.getByRole('combobox').last();
    await payMethodTrigger.click();
    await page.getByRole('option', { name: /cash/i }).click();

    await checkoutDialog.getByRole('button', { name: /manual checkout/i }).click();
    await expect(checkoutDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 10000 });
  });

  // ── Happy Path: Stripe checkout end to end ────────────────────────────────

  test('HP-CHK-1: Stripe checkout — create payment link, pay, verify success page', async ({ page }) => {
    test.setTimeout(90000);
    const dialog = await openCheckoutDialog(page);
    if (!dialog) return;

    await dialog.locator('#charge_amount').fill('200.00');
    await dialog.locator('#tax_amount').fill('20.00');

    const stripeBtn = dialog.getByRole('button', { name: /check out via stripe/i });
    if (!await stripeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'Check Out via Stripe not visible — Stripe may not be connected.');
      return;
    }
    await stripeBtn.click();

    await expect(dialog.getByText(/payment link created/i)).toBeVisible({ timeout: 20000 });
    const paymentLink = dialog.locator('a:has-text("Open payment link")');
    await expect(paymentLink).toBeVisible({ timeout: 5000 });

    const checkoutUrl = await paymentLink.getAttribute('href');
    expect(checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com/);

    await page.goto(checkoutUrl!);
    await page.waitForLoadState('domcontentloaded');
    await fillStripeCard(page, CARD_SUCCESS);
    await submitStripePayment(page);

    await page.waitForURL('**/payment-success**', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: /payment successful/i })).toBeVisible();
  });

  // ── Non-Happy Path: Declined card ────────────────────────────────────────

  test('NHP-CHK-7: Declined card on Stripe checkout shows error, no redirect to success', async ({ page }) => {
    // Create a fresh appointment, save it, reopen it — THEN open checkout
    const apptDialog = await createAndReopenAppointment(page, 'E2E Stripe Decline');

    const checkoutBtn = apptDialog.getByRole('button', { name: /check.?out/i });
    if (!await checkoutBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'Check Out button not available.');
      return;
    }
    await checkoutBtn.click();

    const checkoutDialog = page.getByRole('dialog').filter({ hasText: /check out appointment/i });
    await expect(checkoutDialog).toBeVisible({ timeout: 8000 });
    await checkoutDialog.locator('#charge_amount').fill('50.00');

    const stripeBtn = checkoutDialog.getByRole('button', { name: /check out via stripe/i });
    if (!await stripeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'Stripe not connected — skipping decline test.');
      return;
    }
    await stripeBtn.click();

    const paymentLink = checkoutDialog.locator('a:has-text("Open payment link")');
    await expect(paymentLink).toBeVisible({ timeout: 20000 });
    const checkoutUrl = await paymentLink.getAttribute('href');

    await page.goto(checkoutUrl!);
    await page.waitForLoadState('domcontentloaded');
    await fillStripeCard(page, CARD_DECLINE);
    await submitStripePayment(page);

    await expect(page.getByText(/declined|card was declined/i)).toBeVisible({ timeout: 15000 });
    expect(page.url()).not.toContain('/payment-success');
  });
});
