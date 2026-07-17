import Phaser from "phaser";
import { BoardScene } from "./BoardScene";
import type { GameBridge } from "./GameBridge";

const BOARD_WORLD_SIZE = 720;

export function createBoardGame(parent: HTMLElement, bridge: GameBridge): Phaser.Game {
  // Size the backing buffer by devicePixelRatio (capped at 2 to bound the
  // Canvas renderer's per-frame fill cost). BoardScene compensates with a
  // camera zoom, so all drawing keeps using the 720-unit world space and
  // stays crisp on retina displays.
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const game = new Phaser.Game({
    // The board uses Phaser's 2D graphics API exclusively. Pinning the Canvas
    // renderer avoids blank boards when WebGL is unavailable or disabled.
    type: Phaser.CANVAS,
    parent,
    width: Math.round(BOARD_WORLD_SIZE * dpr),
    height: Math.round(BOARD_WORLD_SIZE * dpr),
    backgroundColor: "#0b101a",
    scene: [new BoardScene(bridge)],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: true,
      roundPixels: true,
    },
  });

  // Mobile browsers can settle the parent's layout after the orientation
  // change event; FIT only re-measures on window resize, so refresh once the
  // new dimensions are stable.
  const refreshScale = () => {
    window.setTimeout(() => game.scale.refresh(), 60);
  };
  window.addEventListener("orientationchange", refreshScale);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    window.removeEventListener("orientationchange", refreshScale);
  });
  return game;
}
