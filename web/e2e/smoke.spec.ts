import { expect, test } from "@playwright/test";

// Full replay of one recorded case (no backend needed: replay mode).
test("walks the pipeline flow, then the review workstation", async ({ page }) => {
  await page.goto("/?replay");
  await page.getByRole("button", { name: /toy-01/ }).click();
  for (const stage of ["input", "tile", "encode", "score", "aggregate", "explain", "report"]) {
    await expect(page.getByTestId(`pop-${stage}`)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("pop-next").click();
  }
  await expect(page.getByTestId("flow-done")).toBeVisible();
  await page.getByRole("tab", { name: "Review workstation" }).click();
  for (const step of ["tile", "encode", "aggregate", "explain", "report"]) {
    await expect(page.getByTestId(`step-${step}`)).toBeVisible({ timeout: 10_000 });
  }
  await expect(page.getByTestId("verifier")).toContainText("checked");
  await page.getByRole("button", { name: /5\s*Explain/ }).click();
  await page.getByRole("tab", { name: "Evidence" }).click();
  await expect(page.getByTestId("logit-total")).toBeVisible();
  await expect(page.getByTestId("slide-viewer")).toBeVisible();
});
