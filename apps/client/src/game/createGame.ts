import Phaser from "phaser";
import { BoardScene } from "./BoardScene";
import type { GameBridge } from "./GameBridge";

export function createBoardGame(parent: HTMLElement, bridge: GameBridge): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 720,
    height: 720,
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
}

