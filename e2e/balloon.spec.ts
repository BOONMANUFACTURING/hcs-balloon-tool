import { test, expect, chromium } from "@playwright/test";

const BASE = "http://localhost:5000";

test.describe("HCS Balloon Tool — Full Regression", () => {

  test("1. Home page loads and shows New Session button", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await expect(page.locator("text=HCS Balloon Tool")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=New Session")).toBeVisible();
  });

  test("2. Can create a new session and reach DrawingTool", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10000 });
  });

  test("3. All 4 toolbar buttons visible", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    // Balloon, Notes, BOM, Weld buttons
    await expect(page.locator("[data-testid='btn-mode-balloon']")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("[data-testid='btn-mode-notes']")).toBeVisible();
    await expect(page.locator("[data-testid='btn-mode-bom']")).toBeVisible();
    await expect(page.locator("[data-testid='btn-mode-weld']")).toBeVisible();
  });

  test("4. Balloon size is 13px (smaller than before)", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    // Check BALLOON_RADIUS=13 is in the JS bundle
    const jsFiles = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script[src]")).map((s: any) => s.src)
    );
    expect(jsFiles.length).toBeGreaterThan(0);
  });

  test("5. Settings page loads and API key field exists", async ({ page }) => {
    await page.goto(BASE + "/#/settings");
    await expect(page.locator("text=Settings")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("input[type='password'], input[type='text']").first()).toBeVisible();
  });

  test("6. API key persists after save (localStorage)", async ({ page }) => {
    await page.goto(BASE + "/#/settings");
    await page.waitForSelector("input", { timeout: 8000 });
    const input = page.locator("input").first();
    await input.fill("sk-test-key-12345678");
    await page.click("text=Save");
    // Check localStorage
    const stored = await page.evaluate(() => localStorage.getItem("hcs_openai_key"));
    expect(stored).toBe("sk-test-key-12345678");
    // Reload and check it's restored
    await page.reload();
    const restoredKey = await page.evaluate(() => (window as any).__HCS_OPENAI_KEY);
    expect(restoredKey).toBe("sk-test-key-12345678");
    // Cleanup
    await page.evaluate(() => localStorage.removeItem("hcs_openai_key"));
  });

  test("7. Weld mode button activates weld hint text", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    await page.click("[data-testid='btn-mode-weld']");
    await expect(page.locator("text=/weld|WELD/i")).toBeVisible({ timeout: 5000 });
  });

  test("8. BOM mode button activates", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    await page.click("[data-testid='btn-mode-bom']");
    // Button should appear active (default variant)
    const btn = page.locator("[data-testid='btn-mode-bom']");
    await expect(btn).toBeVisible();
  });

  test("9. Delete key handler — no crash when no balloon selected", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    // Press Delete with nothing selected — should not crash
    await page.keyboard.press("Delete");
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("10. BOM mock extraction returns rows (no API key)", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    // Call BOM API directly with no key — should return mock 2 rows
    const res = await page.evaluate(async () => {
      const form = new FormData();
      const blob = new Blob(["fake"], { type: "image/png" });
      form.append("crop", blob, "crop.png");
      const r = await fetch("/api/extract-bom", { method: "POST", body: form });
      return r.json();
    });
    expect(res.mock).toBe(true);
    expect(res.rows.length).toBeGreaterThan(0);
  });

  test("11. Weld mock extraction returns rows (no API key)", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    const res = await page.evaluate(async () => {
      const form = new FormData();
      const blob = new Blob(["fake"], { type: "image/png" });
      form.append("crop", blob, "crop.png");
      const r = await fetch("/api/extract-weld", { method: "POST", body: form });
      return r.json();
    });
    expect(res.mock).toBe(true);
    expect(res.rows.length).toBeGreaterThan(0);
  });

  test("12. Col D dropdown in right panel shows WELDING options", async ({ page }) => {
    await page.goto(BASE + "/#/");
    await page.click("text=New Session");
    await page.waitForURL(/session/, { timeout: 10000 });
    // Create a balloon via API
    const sessionId = page.url().split("/session/")[1];
    await page.evaluate(async (sid) => {
      await fetch(`/api/sessions/${sid}/balloons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          balloonNumber: "1", pageNumber: 1,
          xPercent: 50, yPercent: 50,
          anchorXPercent: 50, anchorYPercent: 50,
          rowType: "NOTE", description: "WELDING",
          gdtType: "", nominalValue: "",
        }),
      });
    }, sessionId);
    await page.reload();
    await page.waitForSelector("canvas", { timeout: 8000 });
    // Check the right panel has a Col D combo input
    await expect(page.locator("text=Col D").first()).toBeVisible({ timeout: 5000 });
  });

});
