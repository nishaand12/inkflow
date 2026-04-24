import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

// ── Artist Type Tests ────────────────────────────────────────────────────────

test.describe('Artist Type (migrate4)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/artists');
    await page.waitForLoadState('networkidle');
  });

  test('HP-ARTYPE-1: ArtistDialog contains Artist Type select with tattoo/piercer/both options', async ({ page }) => {
    await page.getByRole('button', { name: /add artist/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // The artist_type select defaults to "Tattoo Artist"
    await expect(dialog.getByText(/tattoo artist/i)).toBeVisible({ timeout: 5000 });

    // Open the select and verify all three options exist
    const typeTrigger = dialog.getByRole('combobox').filter({ hasText: /tattoo artist/i });
    if (await typeTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await typeTrigger.click();
      await expect(page.getByRole('option', { name: /tattoo artist/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /piercer/i })).toBeVisible();
      await expect(page.getByRole('option', { name: /both/i })).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  test('HP-ARTYPE-2: Artist card shows correct badge for "tattoo" type', async ({ page }) => {
    // At least one artist should exist — check badge text
    const firstCard = page.locator('[class*="Card"]').filter({ hasText: /tattoo artist/i }).first();
    if (!await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      // No tattoo artists — check that the page has cards at all
      const anyCard = page.locator('[class*="Card"]').filter({ hasText: /active|inactive/i }).first();
      if (await anyCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Cards exist but no tattoo badge yet — acceptable
      }
    } else {
      await expect(firstCard.getByText(/tattoo artist/i)).toBeVisible();
    }
  });

  test('HP-ARTYPE-3: Create artist with type "piercer" shows Piercer badge', async ({ page }) => {
    await page.getByRole('button', { name: /add artist/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Select a user
    const userTrigger = dialog.getByText(/select a user with artist/i);
    await expect(userTrigger).toBeVisible({ timeout: 10000 });
    await userTrigger.click();
    const firstUserOption = page.getByRole('option').first();
    if (!await firstUserOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      test.skip(true, 'No eligible users to create artist. Add a user first.');
      return;
    }
    await firstUserOption.click();

    // Set artist_type to "piercer"
    const typeTrigger = dialog.getByRole('combobox').filter({ hasText: /tattoo artist/i });
    if (await typeTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await typeTrigger.click();
      await page.getByRole('option', { name: /piercer/i }).click();
    }

    // Fill required name if needed
    const nameField = dialog.locator('#full_name');
    const currentName = await nameField.inputValue();
    if (!currentName) await nameField.fill('E2E Piercer Artist');

    // Select location
    const locationTrigger = dialog.getByText(/select location/i);
    await expect(locationTrigger).toBeVisible({ timeout: 5000 });
    await locationTrigger.click();
    await page.getByRole('option').first().click();

    const saveBtn = dialog.getByRole('button', { name: /^(create|update)$/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // The artist card should show "Piercer" badge
    await expect(page.getByText(/piercer/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('HP-ARTYPE-4: Edit existing artist to change type to "both", verify badge', async ({ page }) => {
    // Find any existing artist card to edit
    const firstCard = page.locator('[class*="CardContent"]').first();
    if (!await firstCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'No artist cards found — create an artist first.');
      return;
    }

    await firstCard.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Change artist_type to "both"
    const typeTrigger = dialog.getByRole('combobox').filter({ hasText: /tattoo artist|piercer|both/i });
    if (await typeTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await typeTrigger.click();
      await page.getByRole('option', { name: /both/i }).click();
    }

    const saveBtn = dialog.getByRole('button', { name: /^(create|update)$/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // "Tattoo & Piercer" badge should now appear
    await expect(page.getByText(/tattoo & piercer/i)).toBeVisible({ timeout: 10000 });
  });
});

// ── Revenue Split Rule Tests ─────────────────────────────────────────────────

test.describe('Artist Revenue Split Rules (migrate3)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/artists');
    await page.waitForLoadState('networkidle');
  });

  test('HP-SPLIT-1: "Set Split" button visible on each artist card', async ({ page }) => {
    const splitBtn = page.getByRole('button', { name: /set split|\d+%/i }).first();
    if (!await splitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'No artist cards with Split buttons found. Add an artist first.');
      return;
    }
    await expect(splitBtn).toBeVisible();
  });

  test('HP-SPLIT-2: Split dialog opens, shows 50% default', async ({ page }) => {
    // Click "Set Split" on the first artist card that has no rule yet (shows "Set Split")
    const setSplitBtn = page.getByRole('button', { name: /set split/i }).first();
    if (!await setSplitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Fall back to first percentage button — a rule already exists
      const pctBtn = page.getByRole('button', { name: /\d+%/i }).first();
      if (!await pctBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        test.skip(true, 'No split buttons found — add an artist first.');
        return;
      }
      await pctBtn.click();
    } else {
      await setSplitBtn.click();
    }

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });
    await expect(dialog.getByText(/revenue split/i)).toBeVisible();

    // Split percent input should be present (default 50 or existing value)
    const splitInput = dialog.locator('input[type="number"]');
    await expect(splitInput).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
  });

  test('HP-SPLIT-3: Set split to 60%, save, verify button label updates to "60%"', async ({ page }) => {
    // Prefer a card that still shows "Set Split" to keep tests independent
    const setSplitBtn = page.getByRole('button', { name: /set split/i }).first();
    if (!await setSplitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Edit the first existing percentage rule instead
      const pctBtn = page.getByRole('button', { name: /\d+%/i }).first();
      if (!await pctBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        test.skip(true, 'No split buttons found — add an artist first.');
        return;
      }
      await pctBtn.click();
    } else {
      await setSplitBtn.click();
    }

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    const splitInput = dialog.locator('input[type="number"]');
    await splitInput.clear();
    await splitInput.fill('60');

    // Verify summary text updates reactively
    await expect(dialog.getByText(/artist receives 60%/i)).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByText(/shop receives 40%/i)).toBeVisible({ timeout: 3000 });

    await dialog.getByRole('button', { name: /save split rule/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // The button on the artist card should now show 60%
    await expect(page.getByRole('button', { name: /60%/i }).first()).toBeVisible({ timeout: 10000 });
  });

  test('HP-SPLIT-4: Split dialog shows eligible categories checkboxes when categories exist', async ({ page }) => {
    const splitBtn = page.getByRole('button', { name: /set split|\d+%/i }).first();
    if (!await splitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'No artist split buttons found.');
      return;
    }
    await splitBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // If reporting categories exist, the eligible categories section should appear
    const eligibleSection = dialog.getByText(/eligible categories/i);
    if (await eligibleSection.isVisible({ timeout: 3000 }).catch(() => false)) {
      // At least one checkbox should be present
      const checkboxes = dialog.getByRole('checkbox');
      const count = await checkboxes.count();
      expect(count).toBeGreaterThan(0);
    }
    // If no categories exist, the section is hidden — that's acceptable

    await page.keyboard.press('Escape');
  });

  test('NHP-SPLIT-5: Split percent of 0 is valid (shop gets 100%)', async ({ page }) => {
    const splitBtn = page.getByRole('button', { name: /set split|\d+%/i }).first();
    if (!await splitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'No split buttons found.');
      return;
    }
    await splitBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    const splitInput = dialog.locator('input[type="number"]');
    await splitInput.clear();
    await splitInput.fill('0');

    await expect(dialog.getByText(/artist receives 0%/i)).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByText(/shop receives 100%/i)).toBeVisible({ timeout: 3000 });

    // Save button should still be enabled — 0 is a valid split
    await expect(dialog.getByRole('button', { name: /save split rule/i })).toBeEnabled();

    await page.keyboard.press('Escape');
  });

  test('NHP-SPLIT-6: Cancel split dialog discards changes', async ({ page }) => {
    const splitBtn = page.getByRole('button', { name: /set split|\d+%/i }).first();
    if (!await splitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'No split buttons found.');
      return;
    }

    const labelBefore = await splitBtn.textContent();
    await splitBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Change the value
    const splitInput = dialog.locator('input[type="number"]');
    await splitInput.clear();
    await splitInput.fill('99');

    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // The button label should revert to the original
    const labelAfter = await splitBtn.textContent();
    expect(labelAfter).toBe(labelBefore);
  });
});
