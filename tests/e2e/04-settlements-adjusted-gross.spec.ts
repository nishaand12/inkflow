import { expect, test } from "@playwright/test";
import { getRequiredAuthEnv, loginAs } from "./helpers/auth";

test.describe("Settlements Detail", () => {
  test("settlement detail shows Adjusted gross metric", async ({ page }) => {
    const { email, password } = getRequiredAuthEnv();
    await loginAs(page, email, password);

    await page.goto("/settlements");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /daily settlements/i })).toBeVisible();

    const viewButton = page.getByRole("link", { name: "View" }).first();
    if (!(await viewButton.isVisible().catch(() => false))) {
      test.skip(true, "No settlement history rows found to open details.");
    }
    await viewButton.click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Adjusted gross", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Adjusted gross = Sales gross minus Online collected/i)).toBeVisible();
  });
});
