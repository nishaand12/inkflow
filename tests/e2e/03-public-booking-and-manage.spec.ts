import { expect, test } from "@playwright/test";
import { getRequiredStudioEnv } from "./helpers/auth";

test.describe("Public Booking + Manage Appointment (Customer Side)", () => {
  test("public booking page loads for an existing studio", async ({ page }) => {
    const { studioId } = getRequiredStudioEnv();
    await page.goto(`/book?studio=${studioId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/booking unavailable/i)).toHaveCount(0);
    await expect(page.getByText(/book your appointment online/i)).toBeVisible();
    await expect(page.getByText(/select service/i)).toBeVisible();
  });

  test("manage appointment page rejects invalid tokens safely", async ({ page }) => {
    await page.goto("/manage-appointment?token=invalid-token-for-e2e");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /unable to load appointment/i })).toBeVisible();
    await expect(page.getByText(/invalid|expired|failed|not found|unable/i).first()).toBeVisible();
  });
});
