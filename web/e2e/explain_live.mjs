// Screenshot the Explanation stage of one case on a running dev server (:5173).
// Usage: node e2e/explain_live.mjs <case_id> <out.png> [width] [height]
import { chromium } from "@playwright/test";

const [caseId, out, w = "1700", h = "790"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto("http://localhost:5173/");
await page.getByRole("button", { name: new RegExp(caseId) }).first().click();
for (const stage of ["input", "tile", "encode", "score", "aggregate"]) {
  await page.getByTestId(`pop-${stage}`).waitFor({ timeout: 300_000 });
  await page.getByTestId("pop-next").click();
}
await page.getByTestId("pop-explain").waitFor({ timeout: 30_000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: out });
await browser.close();
