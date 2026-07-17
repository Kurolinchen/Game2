import { expect } from "@playwright/test";
import { PNG } from "pngjs";

export function uniqueCanvasColors(buffer) {
  const png = PNG.sync.read(buffer);
  const colors = new Set();
  for (let index = 0; index < png.data.length; index += 64) {
    colors.add(
      `${png.data[index]}:${png.data[index + 1]}:${png.data[index + 2]}`,
    );
  }
  return colors.size;
}

export async function startSoloMatch(page, callsign) {
  await page.goto("/");
  await page.getByLabel("Display name").fill(callsign);
  await page.getByRole("button", { name: /^Easy/ }).click();
  await page.getByRole("button", { name: "Start solo operation" }).click();
  await page.getByRole("button", { name: "I'm ready" }).click();
  const skipTutorial = page.getByRole("button", { name: "Skip tutorial" });
  await expect(skipTutorial).toBeVisible();
  await skipTutorial.click();
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

export async function tilePosition(canvas, x, y) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Board canvas has no bounding box.");
  const boardPadding = 56;
  const tileSize = 76;
  return {
    x: ((boardPadding + x * tileSize + tileSize / 2) / 720) * box.width,
    y: ((boardPadding + y * tileSize + tileSize / 2) / 720) * box.height,
  };
}

export async function observedActionState(page) {
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
