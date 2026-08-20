import readline from "node:readline";

const ESC = "\u001b[";
const colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR;

export const style = {
  reset: colorEnabled ? `${ESC}0m` : "",
  bold: (value) => colorEnabled ? `${ESC}1m${value}${ESC}0m` : String(value),
  dim: (value) => colorEnabled ? `${ESC}2m${value}${ESC}0m` : String(value),
  cyan: (value) => colorEnabled ? `${ESC}36m${value}${ESC}0m` : String(value),
  green: (value) => colorEnabled ? `${ESC}32m${value}${ESC}0m` : String(value),
  yellow: (value) => colorEnabled ? `${ESC}33m${value}${ESC}0m` : String(value),
  red: (value) => colorEnabled ? `${ESC}31m${value}${ESC}0m` : String(value),
  magenta: (value) => colorEnabled ? `${ESC}35m${value}${ESC}0m` : String(value),
};

export class PromptInterruptedError extends Error {}

export function clearScreen(output = process.stdout) {
  output.write(`${ESC}2J${ESC}H`);
}

export function assertInteractive(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("crafty-cli requires an interactive terminal (TTY)");
  }
}

export function select(message, choices, options = {}) {
  if (!choices.length) throw new Error("A selection menu requires at least one choice");
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  let selected = Math.min(Math.max(options.initial ?? 0, 0), choices.length - 1);
  let renderedLines = 0;
  const previousRawMode = input.isRaw;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(`${ESC}?25l`);

  const render = () => {
    if (renderedLines) output.write(`${ESC}${renderedLines}F${ESC}J`);
    output.write(`${style.bold(message)}\n`);
    for (let index = 0; index < choices.length; index += 1) {
      const active = index === selected;
      output.write(`${active ? style.cyan("❯") : " "} ${active ? style.bold(choices[index].label) : choices[index].label}\n`);
    }
    output.write(style.dim("  ↑/↓ move · Enter select · Esc back\n"));
    renderedLines = choices.length + 2;
  };

  render();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(Boolean(previousRawMode));
      input.pause();
      output.write(`${ESC}?25h`);
    };
    const onKeypress = (_character, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new PromptInterruptedError("Interrupted"));
        return;
      }
      if (key.name === "escape") {
        cleanup();
        resolve(options.cancelValue ?? null);
        return;
      }
      if (key.name === "up" || key.name === "k") selected = (selected - 1 + choices.length) % choices.length;
      else if (key.name === "down" || key.name === "j") selected = (selected + 1) % choices.length;
      else if (key.name === "home") selected = 0;
      else if (key.name === "end") selected = choices.length - 1;
      else if (key.name === "return" || key.name === "enter") {
        const value = choices[selected].value;
        cleanup();
        resolve(value);
        return;
      } else return;
      render();
    };
    input.on("keypress", onKeypress);
  });
}

export function pause(message = "Press Enter to continue", options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const previousRawMode = input.isRaw;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(style.dim(message));

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(Boolean(previousRawMode));
      input.pause();
      output.write("\n");
    };
    const onKeypress = (_character, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new PromptInterruptedError("Interrupted"));
        return;
      }
      if (key.name !== "return" && key.name !== "enter" && key.name !== "escape") return;
      cleanup();
      resolve();
    };
    input.on("keypress", onKeypress);
  });
}
