import { expect, test } from "@playwright/test";
import { startSoloMatch, tilePosition } from "./helpers.mjs";

// Runs under the "mobile" Playwright project (Pixel 7 emulation: 412x915,
// deviceScaleFactor 2.625, touch enabled).
test("phone HUD keeps actions persistent and the board stays tappable", async ({
  page,
}) => {
  const canvas = await startSoloMatch(page, "Mobile HUD");

  // The action panel must be usable without opening any toggle.
  await expect(page.locator(".ap-display")).toBeVisible();
  await expect(page.locator(".action-buttons")).toBeVisible();
  await expect(page.getByRole("button", { name: "End turn" })).toBeVisible();
  await expect(page.locator(".roster-panel")).toBeHidden();
  await expect(page.locator(".action-log-panel")).toBeHidden();

  // Squad roster and battle log open on demand.
  await page.getByRole("button", { name: /Squad & battle log/ }).tap();
  await expect(page.locator(".roster-panel")).toBeVisible();
  await expect(page.locator(".action-log-panel")).toBeVisible();
  await page.getByRole("button", { name: /Hide squad & battle log/ }).tap();
  await expect(page.locator(".roster-panel")).toBeHidden();

  // The backing buffer renders at devicePixelRatio (capped at 2): 720 * 2.
  const bufferSize = await page.evaluate(() => {
    const boardCanvas = document.querySelector(".board-canvas canvas");
    return { width: boardCanvas.width, height: boardCanvas.height };
  });
  expect(bufferSize).toEqual({ width: 1440, height: 1440 });

  // Two-tap confirmation still works with touch-action disabled on the canvas.
  const destination = await tilePosition(canvas, 1, 1);
  await canvas.tap({ position: destination });
  await expect(page.locator(".ap-number")).toHaveText("6");
  await canvas.tap({ position: destination });
  await expect(page.locator(".ap-number")).toHaveText("5");

  await page.getByRole("button", { name: "Leave" }).tap();
});
