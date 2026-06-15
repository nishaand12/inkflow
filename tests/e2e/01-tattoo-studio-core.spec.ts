import { expect, test } from "@playwright/test";
import { getRequiredAuthEnv, loginAs } from "./helpers/auth";

test.describe("Tattoo Studio Core Flow (Post-Studio Creation)", () => {
  test("owner/admin can access core pages and create an appointment", async ({ page }) => {
    const { email, password } = getRequiredAuthEnv();
    await loginAs(page, email, password);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();

    // Core navigation that should exist after studio creation.
    await expect(page.getByRole("link", { name: "Calendar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Appointments" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Public Templates" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Studio Settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settlements" })).toBeVisible();

    await page.goto("/appointments");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /appointments|my appointments/i }).first()).toBeVisible();

    await page.getByRole("button", { name: /new appointment/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Required fields: location + artist. We select first options if available.
    const locationTrigger = dialog.getByText("Select location", { exact: true });
    if (!(await locationTrigger.isVisible().catch(() => false))) {
      test.skip(true, "No location available to create appointments in this studio.");
    }
    await locationTrigger.click();
    const firstLocation = page.getByRole("option").first();
    await expect(firstLocation).toBeVisible({ timeout: 5000 });
    await firstLocation.click();

    const artistTrigger = dialog.getByText("Select artist", { exact: true });
    if (!(await artistTrigger.isVisible().catch(() => false))) {
      test.skip(true, "No artist available to create appointments in this studio.");
    }
    await artistTrigger.click();
    const firstArtist = page.getByRole("option").first();
    await expect(firstArtist).toBeVisible({ timeout: 5000 });
    await firstArtist.click();

    // Pick a safe future date.
    const dateInput = dialog.locator('input[type="date"]').first();
    if (await dateInput.isVisible().catch(() => false)) {
      const farFuture = new Date();
      farFuture.setDate(farFuture.getDate() + 180);
      await dateInput.fill(farFuture.toISOString().slice(0, 10));
    }

    // Set a unique client name and create.
    const clientName = `E2E Tattoo Client ${Date.now()}`;
    await dialog.locator("#client_name").fill(clientName);

    const saveButton = dialog.getByRole("button", { name: /create|update/i });
    if (!(await saveButton.isEnabled().catch(() => false))) {
      test.skip(true, "Appointment could not be created due to scheduling/workstation constraints.");
    }
    await saveButton.click();
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    await expect(page.getByText(clientName).first()).toBeVisible({ timeout: 15000 });
  });
});
