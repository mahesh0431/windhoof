import { expect, test } from "@playwright/test";

test("fixed-step horse and Rapier WASM run in the browser", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/tests/browser/harness.html?mute=1");
  await expect(page.locator("html")).toHaveAttribute("data-harness-status", "passed");

  const result = await page.evaluate(() => window.__windhoofHorseLabHarness);
  const harnessError = await page.evaluate(() => window.__windhoofHorseLabHarnessError);

  expect(harnessError).toBeUndefined();
  expect(result).toBeDefined();
  expect(result?.tick).toBe(600);
  expect(result?.finalZ).toBeGreaterThan(120);
  expect(result?.finalY).toBeGreaterThanOrEqual(0);
  expect(result?.finalY).toBeLessThan(0.04);
  expect(result?.finalGait).toBe("gallop");
  expect(result?.jumpEvents).toBe(1);
  expect(result?.landingEvents).toBe(1);
  expect(result?.hardLandingEvents).toBe(0);
  expect(result?.resetEvents).toBe(0);
  expect(consoleErrors).toEqual([]);
});
