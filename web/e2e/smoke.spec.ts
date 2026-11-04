import { expect, test } from "@playwright/test";

// Full replay of one recorded case (no backend needed: replay mode).
test("replays the full pipeline for a demo case", async ({ page }) => {
  await page.goto("/?replay");
  await page.getByRole("button", { name: /toy-01/ }).click();
  await expect(page.getByTestId("step-input")).toBeVisible();
  for (const step of ["tile", "encode", "aggregate", "explain", "report"]) {
    await expect(page.getByTestId(`step-${step}`)).toBeVisible({ timeout: 10_000 });
  }
  await expect(page.getByTestId("verifier")).toContainText("checked");
  await page.getByText("Explain").click();
  await expect(page.getByTestId("logit-total")).toBeVisible();
});
