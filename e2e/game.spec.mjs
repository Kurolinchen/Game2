import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

function uniqueCanvasColors(buffer) {
  const png = PNG.sync.read(buffer);
  const colors = new Set();
  for (let index = 0; index < png.data.length; index += 64) {
    colors.add(
      `${png.data[index]}:${png.data[index + 1]}:${png.data[index + 2]}`,
    );
  }
  return colors.size;
}

async function startSoloMatch(page, callsign) {
  await page.goto("/");
  await page.getByLabel("Display name").fill(callsign);
  await page.getByRole("button", { name: /^Easy/ }).click();
  await page.getByRole("button", { name: "Start solo operation" }).click();
  await page.getByRole("button", { name: "I'm ready" }).click();
  const canvas = page.locator(".board-canvas canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-board-ready", "true");
  await expect(page.locator(".room-heading h1")).toContainText(
    "Spend six points",
  );
  await expect(page.locator(".unit-card h2")).toHaveText("Breacher");
  await expect(page.locator(".action-button.active").first()).toBeEnabled();
  await expect(canvas).toHaveAttribute("data-selected-unit", /-breacher$/);
  return canvas;
}

async function tilePosition(canvas, x, y) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Board canvas has no bounding box.");
  const boardPadding = 56;
  const tileSize = 76;
  return {
    x: ((boardPadding + x * tileSize + tileSize / 2) / 720) * box.width,
    y: ((boardPadding + y * tileSize + tileSize / 2) / 720) * box.height,
  };
}

async function observedActionState(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(".board-canvas canvas");
    return {
      ap: document.querySelector(".ap-number")?.textContent ?? null,
      error: document.querySelector(".toast-error")?.textContent ?? null,
      lastPointer: canvas?.getAttribute("data-last-pointer-tile") ?? null,
      boardReady: canvas?.getAttribute("data-board-ready") ?? null,
      connection: document.querySelector(".connection")?.textContent?.trim() ?? null,
      fatalError: document.querySelector(".fatal-error-card h1")?.textContent ?? null,
      fatalMessage:
        document.querySelector(".fatal-error-card")?.getAttribute("data-error-message") ??
        null,
      fatalStack:
        document.querySelector(".fatal-error-card")?.getAttribute("data-error-stack") ??
        null,
    };
  });
}

test("starts a visible CPU match, moves, and reconnects after reload", async ({
  page,
}) => {
  const canvas = await startSoloMatch(page, "Browser Test");
  expect(uniqueCanvasColors(await canvas.screenshot())).toBeGreaterThan(10);

  const destination = await tilePosition(canvas, 1, 1);
  const beforeHover = await canvas.screenshot();
  await canvas.hover({ position: destination });
  await expect(canvas).toHaveAttribute("data-hovered-tile", "1:1");
  const afterHover = await canvas.screenshot();
  expect(afterHover.equals(beforeHover)).toBe(false);

  await canvas.click({ position: destination });
  await page.waitForTimeout(1_000);
  expect(await observedActionState(page)).toEqual({
    ap: "5",
    error: null,
    lastPointer: "1:1",
    boardReady: "true",
    connection: "Live room",
    fatalError: null,
    fatalMessage: null,
    fatalStack: null,
  });

  await page.reload();
  await expect(page.locator(".board-canvas canvas")).toBeVisible();
  await expect(page.getByText("Live room")).toBeVisible();
  await expect(page.locator(".ap-number")).toHaveText("5");
  await expect(page.locator(".room-heading h1")).toContainText(
    "Spend six points",
  );
  await page.getByRole("button", { name: "Leave" }).click();
});

test("touch input previews an action before the second tap confirms it", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 430, height: 932 },
  });
  const page = await context.newPage();
  try {
    const canvas = await startSoloMatch(page, "Touch Test");
    const destination = await tilePosition(canvas, 1, 1);

    await canvas.tap({ position: destination });
    await expect(page.locator(".ap-number")).toHaveText("6");

    await canvas.tap({ position: destination });
    await page.waitForTimeout(1_000);
    expect(await observedActionState(page)).toEqual({
      ap: "5",
      error: null,
      lastPointer: "1:1",
      boardReady: "true",
      connection: "Live room",
      fatalError: null,
      fatalMessage: null,
      fatalStack: null,
    });
    await page.getByRole("button", { name: "Leave" }).click();
  } finally {
    await context.close();
  }
});
