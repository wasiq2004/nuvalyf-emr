import { expect, type Page } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? process.env.PLATFORM_ADMIN_EMAIL ?? "";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.PLATFORM_ADMIN_PASSWORD ?? "";

export async function operatorSignIn(page: Page) {
  expect(ADMIN_EMAIL, "Set E2E_ADMIN_EMAIL / PLATFORM_ADMIN_EMAIL").not.toBe("");
  await page.goto("/platform/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await page.waitForURL("**/platform");
}

/** Signs a clinic user in with a one-time password and sets a permanent one. */
export async function clinicFirstSignIn(
  page: Page,
  clinicCode: string,
  email: string,
  oneTimePassword: string,
  newPassword: string,
  landing = "**/today",
) {
  await page.goto("/login");
  await page.getByLabel("Clinic code").fill(clinicCode);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(oneTimePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/change-password");
  await page.getByLabel("Current password").fill(oneTimePassword);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL(landing);
}

export async function readOneTimePassword(page: Page): Promise<string> {
  await expect(page.getByText("Shown once")).toBeVisible();
  const secret = (await page.locator("code").first().innerText()).trim();
  await page.getByRole("button", { name: "I have saved it" }).click();
  return secret;
}
