import { Page, expect } from '@playwright/test';
import { format, addDays } from 'date-fns';

// Use a date 90 days out — far enough to avoid real appointments conflicting
const testDate = format(addDays(new Date(), 90), 'yyyy-MM-dd');
// Use 14:00 (2 PM) — less likely to conflict with existing artist bookings
const testTime = '14:00';

/**
 * Creates a new appointment via the AppointmentDialog and returns the REOPENED dialog
 * after the appointment is saved. Handles the full save → reopen flow correctly.
 *
 * Key behaviours:
 * - Selects Location and Artist by their Radix placeholder text to avoid index brittleness
 * - Sets date to 90 days from now to minimise artist/station conflicts
 * - Waits up to 5 s for the Work Station query to resolve after artist+location are set.
 *   If available stations exist, selects the first one (AppointmentDialog's handleSubmit
 *   calls window.alert() and aborts if a station is required but not chosen).
 * - Asserts the Create button is enabled before clicking, so any remaining conflict
 *   (stationsFull / artistConflict) surfaces as a clear test error rather than a timeout.
 *
 * @param depositAmount  Set > 0 to enable the deposit link button. Set to 0 to hide it.
 * @param clientName     Unique name used to find the row after saving.
 */
export async function createAndReopenAppointment(
  page: Page,
  clientName: string,
  depositAmount?: number
) {
  await page.goto('/appointments');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /new appointment/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 8000 });

  // ── Location (required) ────────────────────────────────────────────────────
  const locationTrigger = dialog.getByText('Select location', { exact: true });
  await expect(locationTrigger).toBeVisible({ timeout: 8000 });
  await locationTrigger.click();
  const locationOption = page.getByRole('option').first();
  await expect(locationOption).toBeVisible({ timeout: 8000 });
  await locationOption.click();

  // ── Artist (required) ──────────────────────────────────────────────────────
  const artistTrigger = dialog.getByText('Select artist', { exact: true });
  await expect(artistTrigger).toBeVisible({ timeout: 8000 });
  await artistTrigger.click();
  const artistOption = page.getByRole('option').first();
  await expect(artistOption).toBeVisible({ timeout: 8000 });
  await artistOption.click();

  // ── Date (set 90 days out to avoid real-appointment conflicts) ─────────────
  const dateInput = dialog.locator('input[type="date"]').first();
  if (await dateInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dateInput.fill(testDate);
  }

  // ── Start time (14:00 — less likely to conflict) ───────────────────────────
  const timeInput = dialog.locator('input[type="time"]').first();
  if (await timeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await timeInput.fill(testTime);
  }

  // ── Appointment type — explicitly set to "No Type" so appointment_type_id is null
  // rather than '' (empty string), which would fail Supabase UUID column validation.
  const typeTrigger = dialog.getByText('Select type (optional)', { exact: true });
  if (await typeTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    await typeTrigger.click();
    const noTypeOption = page.getByRole('option', { name: /no type/i });
    if (await noTypeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await noTypeOption.click();
    } else {
      // fall back to first option if "No Type" label differs
      const firstOption = page.getByRole('option').first();
      if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstOption.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  }

  // ── Work Station — AppointmentDialog requires one when stations are available.
  // Wait up to 5 s for the station query to resolve after date/artist/location are set.
  // If "Select work station" appears, pick the first available station.
  // handleSubmit calls window.alert() + return if a station is required but not chosen.
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

  // ── Deposit amount (optional override) ────────────────────────────────────
  if (depositAmount !== undefined) {
    const depositField = dialog.locator('#deposit_amount');
    if (await depositField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await depositField.clear();
      await depositField.fill(String(depositAmount));
    }
  }

  // ── Client name ────────────────────────────────────────────────────────────
  const clientNameField = dialog.locator('#client_name');
  await expect(clientNameField).toBeVisible({ timeout: 5000 });
  await clientNameField.fill(clientName);

  // ── Create ─────────────────────────────────────────────────────────────────
  // AppointmentDialog button is "Create" for new and "Update" for existing appointments
  const saveBtn = dialog.getByRole('button', { name: /^(create|update)$/i });
  // Wait for button to be enabled — it's disabled while stationsFull or artistConflict
  await expect(saveBtn).toBeEnabled({ timeout: 10000 });
  await saveBtn.click();

  // Wait for the dialog to close (save succeeded). Allow 30 s for Supabase round-trip.
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await page.waitForLoadState('networkidle');

  // ── Reopen the saved appointment ──────────────────────────────────────────
  const appointmentRow = page.locator('div.cursor-pointer').filter({ hasText: clientName }).first();
  await expect(appointmentRow).toBeVisible({ timeout: 10000 });
  await appointmentRow.click();

  const reopenedDialog = page.getByRole('dialog');
  await expect(reopenedDialog).toBeVisible({ timeout: 8000 });
  return reopenedDialog;
}
