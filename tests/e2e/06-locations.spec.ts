import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

test.describe('Locations', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/locations');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-LOC-1: /locations page loads', async ({ page }) => {
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(500);
  });

  test('HP-LOC-2: Add Location button opens LocationDialog', async ({ page }) => {
    await page.getByRole('button', { name: /add location|new location/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
  });

  test('HP-LOC-3: Create E2E Test Location and verify in list', async ({ page }) => {
    await page.getByRole('button', { name: /add location|new location/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Location Name, Address, and City are all required fields
    await dialog.locator('#name').fill('E2E Test Location');
    await dialog.locator('#address').fill('123 Test Street');
    await dialog.locator('#city').fill('Test City');

    await dialog.getByRole('button', { name: /create/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // CardTitle renders as a styled <div>, not a semantic heading — use .first() to avoid strict mode
    await expect(page.getByText('E2E Test Location').first()).toBeVisible({ timeout: 10000 });
  });

  test('HP-LOC-4: Clicking a location opens dialog in edit mode with name pre-filled', async ({ page }) => {
    const locationItem = page.getByText('E2E Test Location').first();
    await expect(locationItem).toBeVisible({ timeout: 10000 });
    await locationItem.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    const nameField = dialog.locator('#name');
    await expect(nameField).toHaveValue('E2E Test Location');
  });
});
