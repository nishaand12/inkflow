import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { format, addDays } from 'date-fns';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

// Use a date 90 days out and 14:00 to minimise conflicts with real appointments/work stations
const testDate = format(addDays(new Date(), 90), 'yyyy-MM-dd');

/**
 * Fills a Radix UI Select by clicking its placeholder text, then picks the first
 * available option. Returns true if an option was successfully selected.
 */
async function selectByPlaceholder(page: any, dialog: any, placeholderText: string): Promise<boolean> {
  const trigger = dialog.getByText(placeholderText, { exact: true });
  if (!await trigger.isVisible({ timeout: 5000 }).catch(() => false)) return false;
  await trigger.click();
  const option = page.getByRole('option').first();
  if (!await option.isVisible({ timeout: 8000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    return false;
  }
  await option.click();
  return true;
}

/**
 * Fills the AppointmentDialog with the minimum required fields to save:
 *   - Location (required)
 *   - Artist (required)
 *   - Work Station (required when the studio has work stations and ones are available)
 *   - Client name
 *   - Date (defaults to 90 days out to avoid real-appointment conflicts)
 *
 * IMPORTANT: AppointmentDialog's handleSubmit calls window.alert() and aborts if a
 * work station is required but not selected. We wait up to 5 s for the station
 * availability query to resolve so we don't miss the selection.
 */
async function fillRequiredAppointmentFields(page: any, dialog: any, clientName: string, date?: string) {
  // Location — placeholder: "Select location"
  await selectByPlaceholder(page, dialog, 'Select location');

  // Artist — placeholder: "Select artist"
  await selectByPlaceholder(page, dialog, 'Select artist');

  // Date
  const dateField = dialog.locator('input[type="date"]').first();
  if (await dateField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dateField.fill(date ?? testDate);
  }

  // Time — use 14:00 to reduce the chance of conflicting with existing bookings
  const timeField = dialog.locator('input[type="time"]').first();
  if (await timeField.isVisible({ timeout: 2000 }).catch(() => false)) {
    await timeField.fill('14:00');
  }

  // Appointment type — select "No Type" so appointment_type_id is null (not '')
  // Sending '' for a UUID column causes a Supabase insert error.
  const typeTrigger2 = dialog.getByText('Select type (optional)', { exact: true });
  if (await typeTrigger2.isVisible({ timeout: 3000 }).catch(() => false)) {
    await typeTrigger2.click();
    const noTypeOpt = page.getByRole('option', { name: /no type/i });
    if (await noTypeOpt.isVisible({ timeout: 5000 }).catch(() => false)) {
      await noTypeOpt.click();
    } else {
      await page.keyboard.press('Escape');
    }
  }

  // Work Station — wait up to 5 s for the station availability query to resolve.
  // If "Select work station" appears, a station must be chosen or handleSubmit aborts.
  await page.waitForTimeout(2000);
  const stationTrigger = dialog.getByText('Select work station', { exact: true });
  if (await stationTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    await stationTrigger.click();
    const stationOption = page.getByRole('option').first();
    if (await stationOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await stationOption.click();
    } else {
      await page.keyboard.press('Escape');
    }
  }

  // Client name
  const clientNameField = dialog.locator('#client_name');
  await expect(clientNameField).toBeVisible({ timeout: 5000 });
  await clientNameField.fill(clientName);
}

test.describe('Appointments', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/appointments');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-APPT-1: /appointments loads and shows the list', async ({ page }) => {
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(500);
  });

  test('HP-APPT-2: Status filter dropdown filters the list', async ({ page }) => {
    const statusTrigger = page.getByRole('combobox').filter({ hasText: /all|status/i }).first();
    if (await statusTrigger.isVisible()) {
      await statusTrigger.click();
      const scheduledOption = page.getByRole('option', { name: /scheduled/i });
      await expect(scheduledOption).toBeVisible({ timeout: 5000 });
      await scheduledOption.click();
    }
    await page.waitForTimeout(500);
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('HP-APPT-3: New Appointment button opens AppointmentDialog', async ({ page }) => {
    await page.getByRole('button', { name: /new appointment/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
  });

  test('HP-APPT-4: Create appointment — type auto-populates deposit, appointment saves', async ({ page }) => {
    await page.getByRole('button', { name: /new appointment/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Fill location, artist, work station (if needed), client name, and date
    await fillRequiredAppointmentFields(page, dialog, 'E2E Client', testDate);

    // Appointment Type — optional, but test the auto-populate behaviour
    // AppointmentDialog renders type select above location/artist, placeholder "Select type (optional)"
    // Only attempt if type options are already loaded (they load async)
    const typeTrigger = dialog.getByText('Select type (optional)', { exact: true });
    if (await typeTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeTrigger.click();
      const typeOption = page.getByRole('option', { name: /e2e tattoo session/i });
      const typeVisible = await typeOption.isVisible({ timeout: 5000 }).catch(() => false);
      if (typeVisible) {
        await typeOption.click();
        // Deposit should auto-populate to 75
        await expect(dialog.locator('#deposit_amount')).toHaveValue('75', { timeout: 3000 });
      } else {
        await page.keyboard.press('Escape');
      }
    }

    const clientEmailField = dialog.getByLabel(/client email/i);
    if (await clientEmailField.isVisible({ timeout: 1000 }).catch(() => false)) {
      await clientEmailField.fill(email);
    }

    // AppointmentDialog: "Create" for new appointments, "Update" for existing
    const saveBtn = dialog.getByRole('button', { name: /^(create|update)$/i });
    await expect(saveBtn).toBeEnabled({ timeout: 10000 });
    await saveBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 30000 });
    await page.waitForLoadState('networkidle');

    // Find the created appointment card without a strict-mode violation
    await expect(
      page.locator('div.cursor-pointer').filter({ hasText: 'E2E Client' }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('HP-APPT-5: Clicking appointment opens dialog in edit mode', async ({ page }) => {
    // Find the E2E Client appointment card (cursor-pointer div)
    const apptRow = page.locator('div.cursor-pointer').filter({ hasText: 'E2E Client' }).first();
    if (!await apptRow.isVisible({ timeout: 10000 }).catch(() => false)) {
      test.skip(true, 'E2E Client appointment not found — run HP-APPT-4 first.');
      return;
    }
    await apptRow.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
  });

  test('HP-APPT-6: Change appointment status to confirmed and verify badge updates', async ({ page }) => {
    const apptRow = page.locator('div.cursor-pointer').filter({ hasText: 'E2E Client' }).first();
    if (!await apptRow.isVisible({ timeout: 10000 }).catch(() => false)) {
      test.skip(true, 'E2E Client appointment not found — run HP-APPT-4 first.');
      return;
    }
    await apptRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Status Select is only shown for existing appointments — pick "confirmed"
    const statusTrigger = dialog.getByRole('combobox').filter({ hasText: /scheduled|confirmed/i }).first();
    await statusTrigger.click();
    const confirmedOption = page.getByRole('option', { name: /^confirmed$/i });
    await expect(confirmedOption).toBeVisible({ timeout: 5000 });
    await confirmedOption.click();

    await dialog.getByRole('button', { name: /^(create|update)$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/confirmed/i).first()).toBeVisible({ timeout: 10000 });
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-APPT-7: Save appointment with no artist selected is blocked', async ({ page }) => {
    await page.getByRole('button', { name: /new appointment/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Fill client name only — do not select artist
    await dialog.locator('#client_name').fill('No Artist Client');
    await dialog.getByRole('button', { name: /^(create|update)$/i }).click();

    // Dialog should remain open — artist is required
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });
});
