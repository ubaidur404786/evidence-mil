// Does the pipeline view fit the screen? Screenshots + page overflow per viewport.
// Usage: npx vite preview --port 4317   then   node e2e/fit.mjs [out_dir]
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "../docs/screens/fit";
const sizes = [[1366, 768], [1536, 864], [1920, 1080], [390, 844]];
const browser = await chromium.launch();
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://localhost:4317/?replay");
  await page.getByRole("button", { name: /c16-test_001/ }).click();
  await page.getByTestId("pop-input").waitFor({ timeout: 20_000 });
  await page.getByTestId("pop-next").click();
  await page.getByTestId("pop-tile").waitFor({ timeout: 20_000 });
  await page.getByTestId("pop-next").click();
  await page.getByTestId("pop-encode").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(5000);
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const next = await page.getByTestId("pop-next").boundingBox();
  console.log(`${w}x${h}: page overflow ${overflow}px, Next button bottom ${Math.round((next?.y ?? 0) + (next?.height ?? 0))}`);
  await page.screenshot({ path: `${out}/encode-${w}x${h}.png` });
  await page.getByTestId("upload-guide").click();
  await page.screenshot({ path: `${out}/guide-${w}x${h}.png` });
  await page.close();
}
await browser.close();
