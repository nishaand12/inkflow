import { test, expect } from '@playwright/test';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

test.describe('Auth Page', () => {
  test.beforeEach(async ({ page }) => {
    // Clear all storage so any existing Supabase session is wiped before each auth test
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/auth');
    await page.waitForLoadState('networkidle');
    // If the page redirected away from /auth (e.g. cached session), navigate back
    if (!page.url().includes('/auth')) {
      await page.goto('/auth');
      await page.waitForLoadState('networkidle');
    }
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-AUTH-1: Sign in with valid credentials redirects to /dashboard', async ({ page }) => {
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('HP-AUTH-2: Clicking sign-up link shows sign-up mode with Full Name field', async ({ page }) => {
    await expect(page.getByLabel(/full name/i)).not.toBeVisible();
    await page.getByText(/need an account\? sign up/i).click();
    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('HP-AUTH-3: Unauthenticated visit to /dashboard redirects to /auth', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/auth', { timeout: 10000 });
    expect(page.url()).toContain('/auth');
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-AUTH-4: Wrong password shows red error message', async ({ page }) => {
    await page.fill('#email', email);
    await page.fill('#password', 'definitelywrongpassword999');
    await page.click('button[type="submit"]');
    const errorDiv = page.locator('.text-red-600, .text-red-700, [class*="red"]').first();
    await expect(errorDiv).toBeVisible({ timeout: 8000 });
  });

  test('NHP-AUTH-5: Unregistered email shows red error message', async ({ page }) => {
    await page.fill('#email', `notregistered_${Date.now()}@nowhere.test`);
    await page.fill('#password', 'somepassword123');
    await page.click('button[type="submit"]');
    const errorDiv = page.locator('.text-red-600, .text-red-700, [class*="red"]').first();
    await expect(errorDiv).toBeVisible({ timeout: 8000 });
  });
});
