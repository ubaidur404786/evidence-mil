// Storyboard frames of the pipeline flow for one recorded case (docs + demo-video planning).
// Usage: npm run build && npx vite preview --port 4317   then   node e2e/shots.mjs [case_id] [out_dir]
import { chromium } from "@playwright/test";

const caseId = process.argv[2] ?? "c16-test_001";
const out = process.argv[3] ?? "../docs/screens";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:4317/?replay");
await page.getByRole("button", { name: new RegExp(caseId) }).click();
await page.getByRole("button", { name: /Focus/ }).click();
let k = 0;
for (const stage of ["input", "tile", "encode", "score", "aggregate", "explain", "report"]) {
  k++;
  await page.getByTestId("processing").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${k}a-${stage}-compute.png` });
  await page.getByTestId(`pop-${stage}`).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${out}/${k}b-${stage}-playing.png` });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${k}c-${stage}.png` });
  await page.getByTestId("pop-next").click();
}
await page.getByTestId("flow-done").waitFor();
await page.waitForTimeout(1600);
await page.screenshot({ path: `${out}/8-done.png` });
await browser.close();
