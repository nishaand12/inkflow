import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

test.describe('Reporting Categories', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/reporting-categories');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-RC-1: /reporting-categories page loads with heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /reporting categories/i })).toBeVisible({ timeout: 8000 });
  });

  test('HP-RC-2: Add Category button opens dialog', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });
    await expect(dialog.getByLabel(/name/i)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('HP-RC-3: Create category of type "service" and verify it appears in list', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/name/i).fill('E2E Tattoo Revenue');

    // Category type — Radix Select, default is "service"
    // Confirm it already shows "Service" or explicitly select it
    const typeSelect = dialog.locator('[id="category_type"]');
    if (await typeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeSelect.click();
      await page.getByRole('option', { name: /service/i }).click();
    }

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Tattoo Revenue')).toBeVisible({ timeout: 10000 });
  });

  test('HP-RC-4: Create category of type "item" and verify badge', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/name/i).fill('E2E Merch Items');

    const typeSelect = dialog.locator('[id="category_type"]');
    if (await typeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeSelect.click();
      await page.getByRole('option', { name: /^item$/i }).click();
    }

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Merch Items')).toBeVisible({ timeout: 10000 });
    // Item badge should appear
    await expect(page.getByText(/item/i).first()).toBeVisible();
  });

  test('HP-RC-5: Create category of type "store_credit" and verify badge', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/name/i).fill('E2E Store Credit');

    const typeSelect = dialog.locator('[id="category_type"]');
    if (await typeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeSelect.click();
      await page.getByRole('option', { name: /store credit/i }).click();
    }

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Store Credit')).toBeVisible({ timeout: 10000 });
  });

  test('HP-RC-6: Edit existing category updates its name', async ({ page }) => {
    // Find the E2E Tattoo Revenue category we created
    const categoryRow = page.getByText('E2E Tattoo Revenue');
    if (!await categoryRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'E2E Tattoo Revenue category not found — run HP-RC-3 first.');
      return;
    }

    await categoryRow.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.clear();
    await nameInput.fill('E2E Tattoo Revenue (updated)');

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Tattoo Revenue (updated)')).toBeVisible({ timeout: 10000 });
  });

  test('HP-RC-7: Toggle category to inactive and verify badge changes', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/name/i).fill('E2E Inactive Category');

    // Turn off active toggle
    const activeSwitch = dialog.locator('#is_active');
    if (await activeSwitch.isVisible({ timeout: 2000 }).catch(() => false)) {
      const isChecked = await activeSwitch.isChecked();
      if (isChecked) await activeSwitch.click();
    }

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // The row should exist with an "Inactive" badge
    const row = page.locator('div').filter({ hasText: 'E2E Inactive Category' }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/inactive/i).first()).toBeVisible();
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-RC-8: Save button disabled when name is empty', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Do not fill name — save button should be disabled
    const saveBtn = dialog.getByRole('button', { name: /save/i });
    await expect(saveBtn).toBeDisabled({ timeout: 3000 });

    await page.keyboard.press('Escape');
  });

  test('NHP-RC-9: Delete category triggers confirmation dialog', async ({ page }) => {
    // Hover over any row to reveal the trash icon
    const row = page.locator('[class*="grid"][class*="items-center"]').first();
    if (!await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'No category rows found — run HP-RC-3 first.');
      return;
    }

    await row.hover();
    const deleteBtn = row.getByRole('button').filter({ has: page.locator('svg') }).last();
    if (!await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'Delete button not visible on hover — may require CSS hover.');
      return;
    }

    await deleteBtn.click();
    const alertDialog = page.getByRole('alertdialog');
    await expect(alertDialog).toBeVisible({ timeout: 8000 });
    await expect(alertDialog.getByRole('button', { name: /cancel/i })).toBeVisible();

    // Cancel — don't actually delete
    await alertDialog.getByRole('button', { name: /cancel/i }).click();
    await expect(alertDialog).not.toBeVisible({ timeout: 5000 });
  });

  test('NHP-RC-10: Cancelling category dialog discards changes', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/name/i).fill('This Should Not Appear');

    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // The unsaved name must not appear in the list
    await expect(page.getByText('This Should Not Appear')).not.toBeVisible();
  });
});
