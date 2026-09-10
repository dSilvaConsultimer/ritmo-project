// Visual-fidelity verification tool for Sprint 8 — NOT shipped, dev-only.
// Captures every Ritmo route at the mobile (matches PhoneShell's max-w-[430px])
// and desktop viewports, in both themes, so each real-data migration step can
// be diffed against an unmodified baseline. See the Sprint 8 plan,
// "Strengthen visual fidelity verification."
//
// Usage: node scripts/capture-screens.mjs <outDir> <baseUrl> [label]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const ROUTES = ["/", "/transacoes", "/planejamento", "/insights", "/assistente", "/mais"];
const VIEWPORTS = [
  { name: "mobile", width: 412, height: 915 },
  { name: "desktop", width: 1440, height: 900 },
];
const THEMES = ["light", "dark"];

const [, , outDir, baseUrl = "http://localhost:8080", label = "baseline"] = process.argv;
if (!outDir) {
  console.error("Usage: node scripts/capture-screens.mjs <outDir> [baseUrl] [label]");
  process.exit(1);
}

async function run() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme,
      });
      const page = await context.newPage();

      for (const route of ROUTES) {
        await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
        // The app reads localStorage("ritmo-theme") on mount, independent of
        // prefers-color-scheme — set it explicitly and reload so `dark`/light
        // screenshots are deterministic regardless of default.
        await page.evaluate((t) => window.localStorage.setItem("ritmo-theme", t), theme);
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForTimeout(150); // theme-toggle transition settle

        const routeName = route === "/" ? "home" : route.slice(1);
        const fileName = `${routeName}__${viewport.name}__${theme}__${label}.png`;
        await page.screenshot({ path: path.join(outDir, fileName), fullPage: true });
        console.log(`captured ${fileName}`);
      }
      await context.close();
    }
  }

  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
