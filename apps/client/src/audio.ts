import type { BoardActionEvent } from "./game/GameBridge";

let context: AudioContext | undefined;
let muted = window.localStorage.getItem("tactics-lite-muted") === "true";
const storedVolume = Number(window.localStorage.getItem("tactics-lite-volume") ?? "0.45");
let volume = Number.isFinite(storedVolume) ? Math.max(0, Math.min(1, storedVolume)) : 0.45;

function audioContext(): AudioContext | undefined {
  if (muted) return undefined;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(frequency: number, duration: number, offset = 0, type: OscillatorType = "sine"): void {
  const audio = audioContext();
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const start = audio.currentTime + offset;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.13), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function unlockAudio(): void {
  void audioContext();
}

export function setAudioMuted(value: boolean): void {
  muted = value;
  window.localStorage.setItem("tactics-lite-muted", String(value));
  if (!value) unlockAudio();
}

export function setAudioVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
  window.localStorage.setItem("tactics-lite-volume", String(volume));
}

export function playUiSound(): void {
  tone(460, 0.07, 0, "triangle");
}

export function playActionSound(action: Omit<BoardActionEvent, "id">): void {
  if (action.type === "move") {
    (action.path ?? []).slice(0, 4).forEach((_, index) =>
      tone(150 + index * 16, 0.08, index * 0.065, "square"),
    );
    return;
  }
  if (action.type === "attack" || action.type === "overwatch") {
    tone(action.type === "overwatch" ? 720 : 560, 0.1, 0, "sawtooth");
    tone(92, 0.18, 0.08, "square");
    return;
  }
  if (action.type === "ability") {
    tone(330, 0.12, 0, "triangle");
    tone(495, 0.16, 0.08, "sine");
  }
}

export function playOutcomeSound(victory: boolean): void {
  const notes = victory ? [330, 440, 554, 660] : [330, 277, 220];
  notes.forEach((note, index) => tone(note, 0.24, index * 0.11, "triangle"));
}
