import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-DASH-1: Dashboard loads with stat cards after login', async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
    // At least one stat card mentioning a key entity should be visible
    const statText = page.getByText(/appointment|artist|customer|location/i).first();
    await expect(statText).toBeVisible({ timeout: 10000 });
  });

  test('HP-DASH-2: Clicking New Appointment opens the AppointmentDialog', async ({ page }) => {
    const newAppointmentBtn = page.getByRole('button', { name: /new appointment/i });
    await expect(newAppointmentBtn).toBeVisible({ timeout: 10000 });
    await newAppointmentBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
  });

  test('HP-DASH-3: Closing the dialog returns to dashboard without error', async ({ page }) => {
    const newAppointmentBtn = page.getByRole('button', { name: /new appointment/i });
    await newAppointmentBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });

    // Close via Escape key
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/dashboard/);
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-DASH-4: Unauthenticated direct visit to /dashboard redirects to /auth', async ({ page }) => {
    // Clear Supabase localStorage session, then navigate
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/dashboard');
    await page.waitForURL('**/auth', { timeout: 10000 });
    expect(page.url()).toContain('/auth');
  });
});
