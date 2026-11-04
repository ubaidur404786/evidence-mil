// Screenshot each flow stage of one recorded case (for docs and the demo video storyboard).
// Usage: npx vite preview --port 4317 &  then  node e2e/shots.mjs [case_id] [out_dir]
import { chromium } from "@playwright/test";

const caseId = process.argv[2] ?? "c16-test_001";
const out = process.argv[3] ?? "../docs/screens";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:4317/?replay");
await page.getByRole("button", { name: new RegExp(caseId) }).click();
for (const stage of ["input", "tile", "encode", "score", "aggregate", "explain", "report"]) {
  await page.getByTestId(`pop-${stage}`).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/flow-${stage}.png` });
  await page.getByTestId("pop-next").click();
}
await page.getByTestId("flow-done").waitFor();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/flow-done.png` });
await browser.close();
