// Live upload check against a running API (:8000) and dev server (:5173).
// Usage: node e2e/upload_live.mjs <image> [out_dir]
import { chromium } from "@playwright/test";

const image = process.argv[2];
const out = process.argv[3] ?? ".";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
await page.goto("http://localhost:5173/");
await page.getByTestId("upload-open").click();
await page.locator("select").selectOption("c16");
await page.setInputFiles("#file", image);
await page.getByText("Upload and analyse").click();
const t0 = Date.now();
await page.getByTestId("loading").waitFor({ timeout: 60_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/live-loading.png` });
const done = await Promise.race([
  page.getByTestId("flow").waitFor({ timeout: 300_000 }).then(() => "flow"),
  page.getByTestId("error").waitFor({ timeout: 300_000 }).then(() => "error"),
]);
console.log(`${done} after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/live-${done}.png` });
await browser.close();
