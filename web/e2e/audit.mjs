// UI audit: every stage, page and view at common laptop sizes, plus hidden-overflow report.
// Usage: npm run build && npx vite preview --port 4317   then   node e2e/audit.mjs <out_dir> [WxH ...]
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? ".";
const sizes = (process.argv.slice(3).length ? process.argv.slice(3) : ["1366x768", "1536x864", "1920x1080"])
  .map((s) => s.split("x").map(Number));
const browser = await chromium.launch();

async function overflow(page) {
  // Containers that clip or scroll their content: what a user may miss.
  return page.evaluate(() => {
    const sel = [".stage__body", ".stage-col", ".patch-scroll", ".instances", ".main", ".worklist", ".pf-rail", ".theatre"];
    return sel.flatMap((s) => [...document.querySelectorAll(s)].map((el) => {
      const dy = el.scrollHeight - el.clientHeight;
      const dx = el.scrollWidth - el.clientWidth;
      return dy > 2 || dx > 2 ? `${s} ${dx > 2 ? `x+${dx}` : ""}${dy > 2 ? ` y+${dy}` : ""}` : null;
    })).filter(Boolean);
  });
}

for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const tag = `${w}x${h}`;
  await page.goto("http://localhost:4317/?replay");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${tag}-0-home.png` });
  await page.getByRole("button", { name: /c16-test_001/ }).click();
  await page.getByTestId("processing").waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${tag}-1-console.png` });
  for (const stage of ["input", "tile", "encode", "score", "aggregate", "explain", "report"]) {
    await page.getByTestId(`pop-${stage}`).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(5200);
    const ov = await overflow(page);
    console.log(tag, stage, ov.join(" | ") || "no hidden overflow");
    await page.screenshot({ path: `${out}/${tag}-s-${stage}.png` });
    await page.getByTestId("pop-next").click();
  }
  await page.getByTestId("flow-done").waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${tag}-9-done.png` });
  await page.getByRole("tab", { name: "Review workstation" }).click();
  await page.waitForTimeout(12_000);
  console.log(tag, "workstation", (await overflow(page)).join(" | ") || "no hidden overflow");
  await page.screenshot({ path: `${out}/${tag}-w-workstation.png` });
  for (const name of ["How it works", "Compare methods"]) {
    await page.getByRole("button", { name }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${tag}-p-${name.split(" ")[0]}.png` });
  }
  await page.getByTestId("upload-guide").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${tag}-p-upload.png` });
  await page.close();
}
await browser.close();
