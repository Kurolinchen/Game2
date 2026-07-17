import { expect, test } from "@playwright/test";
import {
  observedActionState,
  startSoloMatch,
  tilePosition,
  uniqueCanvasColors,
  waitForStableLayout,
} from "./helpers.mjs";

test("two browsers can duel, surrender, inspect results, and rematch", async ({
  browser,
}) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await first.goto("/");
    await first.getByLabel("Display name").fill("Alpha Browser");
    await first.getByRole("button", { name: "Create private room" }).click();
    const roomCode = await first.locator(".room-code span").textContent();
    expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);

    await second.goto(`/?room=${roomCode}`);
    await second.getByLabel("Display name").fill("Bravo Browser");
    await second.getByRole("button", { name: "Join" }).click();
    await expect(first.getByText("Bravo Browser")).toBeVisible();

    await first.getByRole("button", { name: "I'm ready" }).click();
    await second.getByRole("button", { name: "I'm ready" }).click();
    for (const page of [first, second]) {
      const skipTutorial = page.getByRole("button", { name: "Skip tutorial" });
      await expect(skipTutorial).toBeVisible();
      await skipTutorial.click();
      await expect(page.locator(".board-canvas canvas")).toHaveAttribute(
        "data-board-ready",
        "true",
      );
      await waitForStableLayout(page);
    }

    const firstCanvas = first.locator(".board-canvas canvas");
    await firstCanvas.click({ position: await tilePosition(firstCanvas, 1, 1) });
    await expect(first.locator(".ap-number")).toHaveText("5");
    await expect(second.locator(".ap-number")).toHaveText("5");

    first.once("dialog", (dialog) => dialog.accept());
    await first.getByRole("button", { name: "Surrender match" }).click();
    await expect(first.getByRole("heading", { name: "Defeat" })).toBeVisible();
    await expect(second.getByRole("heading", { name: "Victory" })).toBeVisible();
    await expect(first.locator(".result-stats")).toContainText("AP spent");

    await first.getByRole("button", { name: "Play rematch" }).click();
    await second.getByRole("button", { name: "Play rematch" }).click();
    await expect(first.locator(".ap-number")).toHaveText("6");
    await expect(second.locator(".ap-number")).toHaveText("6");
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()]);
  }
});

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
