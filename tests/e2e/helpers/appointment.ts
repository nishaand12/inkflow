import { Page, expect } from '@playwright/test';
import { format, addDays } from 'date-fns';

// 365 days out — far enough to avoid real appointment conflicts in production DB.
// 90 days was too close; live bookings at that date caused stationsFull = true.
const testDate = format(addDays(new Date(), 365), 'yyyy-MM-dd');

// Try these start times in order until the Create button becomes enabled.
// stationsFull or artistConflict disables the button; cycling times finds a free slot.
const CANDIDATE_TIMES = ['14:00', '10:00', '11:00', '09:00', '15:00', '16:00'];

/**
 * Creates a new appointment via the AppointmentDialog and returns the REOPENED dialog
 * after the appointment is saved. Handles the full save → reopen flow correctly.
 *
 * Key behaviours:
 * - Uses a date 365 days from now to minimise artist/station conflicts on production DB.
 * - Cycles through candidate start times until the Create button is enabled.
 * - Asserts the Create button is enabled before clicking.
 *
 * @param clientName     Unique name used to find the row after saving.
 * @param depositAmount  Set > 0 to enable the deposit link button. Set to 0 to hide it.
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

  // ── Date (365 days out to avoid real-appointment conflicts) ────────────────
  const dateInput = dialog.locator('input[type="date"]').first();
  if (await dateInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dateInput.fill(testDate);
  }

  // ── Appointment type — set to "No Type" to avoid UUID validation errors ────
  const typeTrigger = dialog.getByText('Select type (optional)', { exact: true });
  if (await typeTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    await typeTrigger.click();
    const noTypeOption = page.getByRole('option', { name: /no type/i });
    if (await noTypeOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await noTypeOption.click();
    } else {
      const firstOption = page.getByRole('option').first();
      if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstOption.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }
  }

  // ── Time — cycle candidates until Create button is enabled ─────────────────
  // stationsFull or artistConflict keeps the button disabled. Cycling times
  // finds a slot that has a free workstation and no artist conflict.
  const saveBtn = dialog.getByRole('button', { name: /^(create|update)$/i });

  for (const candidateTime of CANDIDATE_TIMES) {
    const timeInput = dialog.locator('input[type="time"]').first();
    if (await timeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await timeInput.fill(candidateTime);
    }

    // Wait for workstation availability query to resolve after time change
    await page.waitForTimeout(2500);

    // Select workstation if the dropdown is shown
    const stationTrigger = dialog.getByText('Select work station', { exact: true });
    if (await stationTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
      await stationTrigger.click();
      const stationOption = page.getByRole('option').first();
      if (await stationOption.isVisible({ timeout: 5000 }).catch(() => false)) {
        await stationOption.click();
      } else {
        await page.keyboard.press('Escape');
      }
    }

    const enabled = await saveBtn.isEnabled({ timeout: 3000 }).catch(() => false);
    if (enabled) break;
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
  await expect(saveBtn).toBeEnabled({ timeout: 10000 });
  await saveBtn.click();

  // Wait for dialog to close (save succeeded). Allow 30 s for Supabase round-trip.
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
