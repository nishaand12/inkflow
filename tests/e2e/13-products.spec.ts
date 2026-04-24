import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

/**
 * Writes a temporary CSV file and returns its path.
 * Playwright's setInputFiles() expects a real file on disk.
 */
function writeTempCsv(content: string): string {
  const tmpPath = path.join(os.tmpdir(), `inkflow-test-${Date.now()}.csv`);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  return tmpPath;
}

test.describe('Products', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/products');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-PRD-1: /products page loads with table and heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /products/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /add product/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /import csv/i })).toBeVisible();
  });

  test('HP-PRD-2: Add Product button opens dialog with all fields', async ({ page }) => {
    await page.getByRole('button', { name: /add product/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Verify key fields are present
    await expect(dialog.locator('#name')).toBeVisible();
    await expect(dialog.locator('#sku')).toBeVisible();
    await expect(dialog.locator('#barcode')).toBeVisible();
    await expect(dialog.locator('#price')).toBeVisible();
    await expect(dialog.locator('#cost')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  test('HP-PRD-3: Create product with required fields and verify in list', async ({ page }) => {
    await page.getByRole('button', { name: /add product/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.locator('#name').fill('E2E Aftercare Lotion');
    await dialog.locator('#sku').fill('E2E-SKU-001');
    await dialog.locator('#barcode').fill('012345670001');
    await dialog.locator('#price').fill('24.99');
    await dialog.locator('#cost').fill('8.50');

    const saveBtn = dialog.getByRole('button', { name: /save product/i });
    await expect(saveBtn).toBeEnabled({ timeout: 3000 });
    await saveBtn.click();

    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Aftercare Lotion')).toBeVisible({ timeout: 10000 });
  });

  test('HP-PRD-4: Create product with reporting category assigned', async ({ page }) => {
    // Only works if at least one reporting category exists
    await page.getByRole('button', { name: /add product/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.locator('#name').fill('E2E Product With Category');
    await dialog.locator('#price').fill('15.00');

    // Try to select a category if available
    const categoryTrigger = dialog.getByText(/select a category/i);
    if (await categoryTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await categoryTrigger.click();
      const firstOption = page.getByRole('option').first();
      if (await firstOption.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstOption.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }

    await dialog.getByRole('button', { name: /save product/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Product With Category')).toBeVisible({ timeout: 10000 });
  });

  test('HP-PRD-5: Search filters products by name', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search products/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('E2E Aftercare');
    await page.waitForTimeout(400);

    // At least one match should be visible and the count should reflect it
    await expect(page.getByText('E2E Aftercare Lotion')).toBeVisible({ timeout: 5000 });
  });

  test('HP-PRD-6: Search filters products by barcode', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search products/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('012345670001');
    await page.waitForTimeout(400);

    await expect(page.getByText('E2E Aftercare Lotion')).toBeVisible({ timeout: 5000 });
  });

  test('HP-PRD-7: Edit product — update name and price, verify changes', async ({ page }) => {
    const row = page.locator('tr').filter({ hasText: 'E2E Aftercare Lotion' }).first();
    if (!await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'E2E Aftercare Lotion not found — run HP-PRD-3 first.');
      return;
    }

    await row.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    const nameInput = dialog.locator('#name');
    await nameInput.clear();
    await nameInput.fill('E2E Aftercare Lotion v2');

    const priceInput = dialog.locator('#price');
    await priceInput.clear();
    await priceInput.fill('27.99');

    await dialog.getByRole('button', { name: /save product/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Aftercare Lotion v2')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('$27.99')).toBeVisible();
  });

  test('HP-PRD-8: Toggle product to Inactive via edit dialog', async ({ page }) => {
    const row = page.locator('tr').filter({ hasText: 'E2E Product With Category' }).first();
    if (!await row.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'E2E Product With Category not found — run HP-PRD-4 first.');
      return;
    }

    await row.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Toggle Active switch off
    const activeSwitch = dialog.locator('#is_active');
    const isChecked = await activeSwitch.isChecked({ timeout: 3000 }).catch(() => true);
    if (isChecked) await activeSwitch.click();

    await dialog.getByRole('button', { name: /save product/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Inactive badge should be visible in the row
    const updatedRow = page.locator('tr').filter({ hasText: 'E2E Product With Category' }).first();
    await expect(updatedRow.getByText(/inactive/i)).toBeVisible({ timeout: 8000 });
  });

  test('HP-PRD-9: CSV import success with valid data', async ({ page }) => {
    const csvContent = `name,sku,barcode,price,cost\nE2E CSV Product A,CSV-001,9990000001,19.99,5.00\nE2E CSV Product B,CSV-002,9990000002,9.99,2.50`;
    const tmpFile = writeTempCsv(csvContent);

    // Playwright's setInputFiles triggers the hidden file input
    await page.locator('input[type="file"][accept=".csv"]').setInputFiles(tmpFile);
    await page.waitForTimeout(2000);

    await expect(page.getByText(/successfully imported 2 product/i)).toBeVisible({ timeout: 10000 });

    fs.unlinkSync(tmpFile);
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-PRD-10: CSV import shows error for row missing product name', async ({ page }) => {
    const csvContent = `name,sku,barcode,price\n,BAD-SKU,,10.00`;
    const tmpFile = writeTempCsv(csvContent);

    await page.locator('input[type="file"][accept=".csv"]').setInputFiles(tmpFile);
    await page.waitForTimeout(2000);

    await expect(page.getByText(/missing product name/i)).toBeVisible({ timeout: 8000 });

    fs.unlinkSync(tmpFile);
  });

  test('NHP-PRD-11: CSV import shows error for unknown category_name', async ({ page }) => {
    const csvContent = `name,sku,barcode,price,category_name\nE2E Bad Cat,BAD-001,,10.00,NonExistentCategoryXYZ`;
    const tmpFile = writeTempCsv(csvContent);

    await page.locator('input[type="file"][accept=".csv"]').setInputFiles(tmpFile);
    await page.waitForTimeout(2000);

    await expect(page.getByText(/category.*not found/i)).toBeVisible({ timeout: 8000 });

    fs.unlinkSync(tmpFile);
  });

  test('NHP-PRD-12: Save button disabled when product name is empty', async ({ page }) => {
    await page.getByRole('button', { name: /add product/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Leave name empty
    const saveBtn = dialog.getByRole('button', { name: /save product/i });
    await expect(saveBtn).toBeDisabled({ timeout: 3000 });

    await page.keyboard.press('Escape');
  });

  test('NHP-PRD-13: Delete product triggers confirmation, cancel keeps product in list', async ({ page }) => {
    // Use any E2E product — find a delete icon button in any row
    const deleteBtn = page.locator('tr').filter({ hasText: /E2E/ }).locator('button').last().first();
    if (!await deleteBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip(true, 'No E2E product rows found — run HP-PRD-3 first.');
      return;
    }

    await deleteBtn.click();
    const alertDialog = page.getByRole('alertdialog');
    await expect(alertDialog).toBeVisible({ timeout: 8000 });
    await expect(alertDialog.getByRole('button', { name: /cancel/i })).toBeVisible();

    await alertDialog.getByRole('button', { name: /cancel/i }).click();
    await expect(alertDialog).not.toBeVisible({ timeout: 5000 });

    // Product should still be in the list
    await expect(page.locator('tr').filter({ hasText: /E2E/ }).first()).toBeVisible();
  });
});
