import { expect, test } from "@playwright/test";
import { getRequiredAuthEnv, loginAs } from "./helpers/auth";

test.describe("Public Templates (Default Emails + Category Notifications)", () => {
  test("tab labels, placeholder guidance, and category override help text are visible", async ({ page }) => {
    const { email, password } = getRequiredAuthEnv();
    await loginAs(page, email, password);

    await page.goto("/public-templates");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /public templates/i })).toBeVisible();

    await expect(page.getByRole("tab", { name: "Public booking" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Default Emails" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Category Notifications" })).toBeVisible();

    // Default Emails tab placeholder docs.
    await page.getByRole("tab", { name: "Default Emails" }).click();
    await expect(page.getByText(/supported placeholders/i).first()).toBeVisible();
    await expect(page.getByText("{{manage_appointment_link}}")).toBeVisible();
    await expect(page.getByText("{{aftercare_instructions}}")).toHaveCount(0);

    // Category Notifications tab help text + placeholders.
    await page.getByRole("tab", { name: "Category Notifications" }).click();
    await expect(page.getByText(/supported placeholders/i).first()).toBeVisible();
    await expect(page.getByText("{{studio_email}}")).toBeVisible();
    await expect(page.getByText("{{aftercare_instructions}}")).toHaveCount(0);

    const firstCategoryAccordion = page.getByText(/override reminders and follow-ups for all/i).first();
    if (!(await firstCategoryAccordion.isVisible().catch(() => false))) {
      test.skip(true, "No booking category roots found in this studio.");
    }
    await firstCategoryAccordion.click();

    await expect(page.getByText(/send for this category/i).first()).toBeVisible();
    await expect(page.getByText(/Inherit/i).first()).toBeVisible();
    await expect(page.getByText(/Enabled/i).first()).toBeVisible();
    await expect(page.getByText(/Disabled/i).first()).toBeVisible();
    await expect(page.getByText(/setting from Default Emails for this category/i).first()).toBeVisible();
  });
});
