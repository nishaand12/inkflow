import { Page, test } from "@playwright/test";

export function getRequiredAuthEnv() {
  const email = process.env.TEST_TESTER_EMAIL;
  const password = process.env.TEST_TESTER_PASSWORD;
  if (!email || !password) {
    test.skip(true, "TEST_TESTER_EMAIL and TEST_TESTER_PASSWORD must be set in playwright.env");
  }
  return { email: email!, password: password! };
}

export function getRequiredStudioEnv() {
  const studioId = process.env.TEST_STUDIO_ID;
  if (!studioId) {
    test.skip(true, "TEST_STUDIO_ID must be set in playwright.env for public booking tests");
  }
  return { studioId: studioId! };
}

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth");
  await page.waitForLoadState("networkidle");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: /sign in|login/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });
}
