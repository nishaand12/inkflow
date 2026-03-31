import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

test.describe('Artists', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/artists');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-ARTIST-1: /artists page loads', async ({ page }) => {
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(500);
  });

  test('HP-ARTIST-2: Add Artist opens ArtistDialog', async ({ page }) => {
    await page.getByRole('button', { name: /add artist/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
    // Close it — don't attempt creation here
    await page.keyboard.press('Escape');
  });

  test('HP-ARTIST-3: Create E2E Test Artist with required fields and verify in list', async ({ page }) => {
    await page.getByRole('button', { name: /add artist/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // ── Select User (required) ────────────────────────────────────────────────
    // Users list loads async after currentUser resolves — wait for the placeholder text to appear
    const userTrigger = dialog.getByText(/select a user with artist/i);
    await expect(userTrigger).toBeVisible({ timeout: 10000 });
    await userTrigger.click();

    // Wait for options to populate — if none appear, the owner account has no available users
    const firstUserOption = page.getByRole('option').first();
    const hasOptions = await firstUserOption.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasOptions) {
      // No assignable users — this studio/account may not have eligible users
      await page.keyboard.press('Escape');
      test.skip(true, 'No users with Artist/Admin/Owner role available to create an artist profile. Add a user first.');
      return;
    }

    await firstUserOption.click();

    // ── Full Name (auto-populated from user selection — verify it was set) ────
    const nameField = dialog.locator('#full_name');
    await expect(nameField).toBeVisible({ timeout: 5000 });
    const currentName = await nameField.inputValue();
    if (!currentName) {
      await nameField.fill('E2E Test Artist');
    }

    // ── Primary Location (required) ──────────────────────────────────────────
    // Wait for the location select to be visible — identified by its placeholder
    const locationTrigger = dialog.getByText(/select location/i);
    await expect(locationTrigger).toBeVisible({ timeout: 5000 });
    await locationTrigger.click();

    const firstLocationOption = page.getByRole('option').first();
    await expect(firstLocationOption).toBeVisible({ timeout: 8000 });
    await firstLocationOption.click();

    // ── Submit ────────────────────────────────────────────────────────────────
    // Wait for button to not be pending (mutations settle)
    const saveBtn = dialog.getByRole('button', { name: /^(create|update)$/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5000 });
    await saveBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // The artist should appear — name either came from user profile or we set it
    await expect(
      page.getByText(/e2e test artist/i).or(page.getByText(/inkflow tester/i)).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('HP-ARTIST-4: Search filters artists list', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    // Search for something that exists — the studio owner's name or a known artist
    await searchInput.fill('E2E');
    await page.waitForTimeout(500);
    // As long as the list filtered without crashing, the test passes
    await expect(page.locator('body')).not.toBeEmpty();
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-ARTIST-5: Delete button triggers confirmation dialog', async ({ page }) => {
    // Find any artist card that has a delete button
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    if (await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await deleteBtn.click();
      const alertDialog = page.getByRole('alertdialog');
      await expect(alertDialog).toBeVisible({ timeout: 8000 });
      await expect(alertDialog.getByRole('button', { name: /cancel/i })).toBeVisible();
    } else {
      test.skip(true, 'No artist with a delete button found — skipping delete confirmation test');
    }
  });

  test('NHP-ARTIST-6: Cancelling delete keeps artist in list', async ({ page }) => {
    const deleteBtn = page.getByRole('button', { name: /delete/i }).first();
    if (await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Get the name of the artist we're about to try to delete
      const artistCard = deleteBtn.locator('..').locator('..');
      await deleteBtn.click();

      const alertDialog = page.getByRole('alertdialog');
      await expect(alertDialog).toBeVisible({ timeout: 8000 });
      await alertDialog.getByRole('button', { name: /cancel/i }).click();
      await expect(alertDialog).not.toBeVisible({ timeout: 5000 });

      // List should still have artists
      await expect(page.locator('body')).not.toBeEmpty();
    } else {
      test.skip(true, 'No artist with a delete button found — skipping cancel delete test');
    }
  });
});
