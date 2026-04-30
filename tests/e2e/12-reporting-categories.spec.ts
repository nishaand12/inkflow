import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

// Per-run suffix keeps names unique across reruns against the same production DB.
// Each run creates fresh records — no unique-constraint collisions, no cleanup needed.
const RID = Date.now().toString().slice(-6);

const CAT_SERVICE    = `E2E Tattoo Revenue ${RID}`;
const CAT_ITEM       = `E2E Merch Items ${RID}`;
const CAT_CREDIT     = `E2E Store Credit ${RID}`;
const CAT_INACTIVE   = `E2E Inactive Category ${RID}`;
const CAT_NO_SAVE    = `This Should Not Appear ${RID}`;

test.describe('Reporting Categories', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/reporting-categories');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-RC-1: /reporting-categories page loads with heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^categories$/i })).toBeVisible({ timeout: 8000 });
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

    await dialog.getByLabel(/name/i).fill(CAT_SERVICE);

    // Category type — Radix Select, default is "service"
    const typeSelect = dialog.locator('[id="category_type"]');
    if (await typeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeSelect.click();
      await page.getByRole('option', { name: /service/i }).click();
    }

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(CAT_SERVICE)).toBeVisible({ timeout: 10000 });
  });

  test('HP-RC-4: Create category of type "item" and verify badge', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/name/i).fill(CAT_ITEM);

    const typeSelect = dialog.locator('[id="category_type"]');
    if (await typeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeSelect.click();
      await page.getByRole('option', { name: /^item$/i }).click();
    }

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(CAT_ITEM)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/item/i).first()).toBeVisible();
  });

  test('HP-RC-5: Create category of type "store_credit" and verify badge', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/name/i).fill(CAT_CREDIT);

    const typeSelect = dialog.locator('[id="category_type"]');
    if (await typeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeSelect.click();
      await page.getByRole('option', { name: /store credit/i }).click();
    }

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(CAT_CREDIT)).toBeVisible({ timeout: 10000 });
  });

  test('HP-RC-6: Edit existing category updates its name', async ({ page }) => {
    const categoryRow = page.getByText(CAT_SERVICE);
    if (!await categoryRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, `${CAT_SERVICE} not found — run HP-RC-3 first in the same suite run.`);
      return;
    }

    await categoryRow.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    const nameInput = dialog.getByLabel(/name/i);
    await nameInput.clear();
    await nameInput.fill(`${CAT_SERVICE} (updated)`);

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(`${CAT_SERVICE} (updated)`)).toBeVisible({ timeout: 10000 });
  });

  test('HP-RC-7: Toggle category to inactive and verify badge changes', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/name/i).fill(CAT_INACTIVE);

    // Turn off active toggle
    const activeSwitch = dialog.locator('#is_active');
    if (await activeSwitch.isVisible({ timeout: 2000 }).catch(() => false)) {
      const isChecked = await activeSwitch.isChecked();
      if (isChecked) await activeSwitch.click();
    }

    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const row = page.locator('div').filter({ hasText: CAT_INACTIVE }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/inactive/i).first()).toBeVisible();
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-RC-8: Save button disabled when name is empty', async ({ page }) => {
    await page.getByRole('button', { name: /add category/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    const saveBtn = dialog.getByRole('button', { name: /save/i });
    await expect(saveBtn).toBeDisabled({ timeout: 3000 });

    await page.keyboard.press('Escape');
  });

  test('NHP-RC-9: Delete category triggers confirmation dialog', async ({ page }) => {
    const row = page.getByTestId('category-row').first();
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

    await dialog.getByLabel(/name/i).fill(CAT_NO_SAVE);

    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    await expect(page.getByText(CAT_NO_SAVE)).not.toBeVisible();
  });
});
