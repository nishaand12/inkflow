import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

test.describe('Phase 1 - Account and Studio Setup', () => {
  test('Create test account and studio', async ({ page }) => {
    // ── Guard: ensure env vars are set ──────────────────────────────────────
    if (!email || !password) {
      throw new Error(
        'TEST_TESTER_EMAIL and TEST_TESTER_PASSWORD must be set in playwright.env before running Phase 1.'
      );
    }

    // ── Step 1-6: Sign up ────────────────────────────────────────────────────
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');

    // Switch to sign-up mode
    await page.getByText(/need an account\? sign up/i).click();
    await expect(page.getByLabel(/full name/i)).toBeVisible();

    await page.getByLabel(/full name/i).fill('InkFlow Tester');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');

    // Expect the email confirmation message
    await expect(
      page.getByText(/check your email to confirm your account/i)
    ).toBeVisible({ timeout: 10000 });

    // ── Pause Point 1: email confirmation + re-login ─────────────────────────
    console.log('\n=== ACTION REQUIRED ===');
    console.log(`Check your inbox at ${email} for an email from Supabase.`);
    console.log('Click the confirmation link in the email.');
    console.log('You will be redirected back to the app and may need to sign in again.');
    console.log('Sign in with your credentials at http://localhost:3000/auth');
    console.log('Once you are signed in and see the InkFlow UI, click Resume in the Playwright Inspector.');
    console.log('========================\n');

    await page.pause();

    // ── Step 8-12: Post-confirmation onboarding ───────────────────────────────
    // After email confirmation, Supabase may redirect to the app or require re-login.
    // The pause above ensures the user has signed in. We now navigate directly.
    const currentUrl = page.url();
    if (currentUrl.includes('/auth')) {
      // Still on auth page — sign in now
      await page.fill('#email', email);
      await page.fill('#password', password);
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard', { timeout: 15000 });
    }

    await page.goto('/onboarding-choice');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/create new studio/i).first()).toBeVisible({ timeout: 10000 });
    await page.getByText(/create new studio/i).first().click();

    await expect(page.getByLabel(/studio name/i)).toBeVisible({ timeout: 5000 });

    // ── Step 13-15: Fill in studio creation form ──────────────────────────────
    const studioName = `Test Studio ${Date.now()}`;

    await page.getByLabel(/studio name/i).fill(studioName);
    await page.getByLabel(/headquarters location/i).fill('Test City, CA');

    const phoneField = page.getByLabel(/phone/i);
    if (await phoneField.isVisible()) {
      await phoneField.fill('555-0100');
    }

    await page.getByLabel(/studio email/i).fill(email);

    // Currency defaults to USD — leave as-is
    await page.getByRole('button', { name: /create studio/i }).click();

    // ── Step 16-17: Wait for redirect to studio settings ─────────────────────
    await page.waitForURL(/studio.?settings/i, { timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // Confirm page loaded — look for any recognizable studio settings content
    await expect(
      page.getByText(/studio|settings|stripe|email/i).first()
    ).toBeVisible({ timeout: 10000 });

    // ── Pause Point 2: manual studio activation + Stripe connect ─────────────
    console.log('\n=== ACTION REQUIRED ===');
    console.log(`Studio name created: "${studioName}"`);
    console.log('1. Go to your Supabase dashboard → Table Editor → studios');
    console.log(`   Find "${studioName}" and set is_active = true`);
    console.log('2. Return to the app at http://localhost:3000/studio-settings');
    console.log('   Connect your Stripe test account using the Connect Stripe button.');
    console.log('   Wait until stripe_charges_enabled = true (the page will show a green connected badge).');
    console.log('3. Once both are done, click Resume in the Playwright Inspector.');
    console.log('========================\n');

    await page.pause();

    // ── Step 19-20: Verify dashboard loads after activation ───────────────────
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText(/dashboard|appointment|artist|customer/i).first()
    ).toBeVisible({ timeout: 10000 });

    // ── Step 21: Write studio name to playwright.env ─────────────────────────
    const envPath = path.resolve(__dirname, '../../../playwright.env');
    const envContents = fs.readFileSync(envPath, 'utf-8');

    const updatedContents = envContents.includes('TEST_STUDIO_NAME=')
      ? envContents.replace(/TEST_STUDIO_NAME=.*/, `TEST_STUDIO_NAME=${studioName}`)
      : envContents + `\nTEST_STUDIO_NAME=${studioName}\n`;

    fs.writeFileSync(envPath, updatedContents, 'utf-8');
    console.log(`\nTEST_STUDIO_NAME="${studioName}" written to playwright.env`);

    // ── Step 22: Final instructions ───────────────────────────────────────────
    console.log('\n=== PHASE 1 COMPLETE ===');
    console.log('You can now run Phase 2 tests with:');
    console.log("  npm run test:e2e");
    console.log('Videos and traces for all tests will be saved to ./playwright-results/');
    console.log('========================\n');
  });
});
