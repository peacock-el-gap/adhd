import * as readline from "node:readline";

export interface GateOption {
  key: string; // Single char: "a", "c", "s", etc.
  label: string; // Display text: "Approve — proceed to building"
  isDefault: boolean; // Shown as [A] vs [a], executed on timeout
}

export interface GateResult {
  key: string; // Which option was selected
  timedOut: boolean; // Was it the timeout default?
  freeText?: string; // For gates that accept text input
}

/**
 * Display a timed interactive gate. Returns user's choice.
 * In non-interactive mode, returns the default option immediately.
 *
 * Special option key "w" (Wait): pauses countdown, switches to blocking mode.
 * Uses process.stdin in raw mode for single-keypress detection.
 * Falls back to readline if raw mode unavailable.
 */
export async function promptGate(
  message: string,
  options: GateOption[],
  timeoutSec: number,
  interactive: boolean,
): Promise<GateResult> {
  return promptGateWithText(message, options, timeoutSec, interactive);
}

/**
 * Variant that also accepts free-text input after selection.
 * Used by A3's "revise" option where user types feedback.
 */
export async function promptGateWithText(
  message: string,
  options: GateOption[],
  timeoutSec: number,
  interactive: boolean,
  textPromptForKey?: string,
): Promise<GateResult> {
  // biome-ignore lint/style/noNonNullAssertion: options is guaranteed non-empty by callers
  const defaultOption = options.find((o) => o.isDefault) ?? options[0]!;

  // Non-interactive: return default immediately
  if (!interactive) {
    return { key: defaultOption.key, timedOut: false };
  }

  // Display message and options
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const RST = "\x1b[0m";
  const YELLOW = "\x1b[33m";

  process.stdout.write(`\n${BOLD}[HARNESS]${RST} ${message}\n\n`);
  for (const opt of options) {
    const keyDisplay = opt.isDefault ? `[${opt.key.toUpperCase()}]` : `[${opt.key}]`;
    process.stdout.write(`  ${YELLOW}${keyDisplay}${RST} ${opt.label}\n`);
  }

  if (timeoutSec > 0) {
    process.stdout.write(`  ${DIM}(auto-${defaultOption.key} in ${timeoutSec}s)${RST}\n`);
  }
  process.stdout.write("\n");

  const validKeys = new Set(options.map((o) => o.key.toLowerCase()));

  // Try raw mode for single-keypress detection
  const selectedKey = await new Promise<string>((resolve) => {
    let remaining = timeoutSec;
    let timer: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      if (timer) clearInterval(timer);
      if (process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.stdin.removeAllListeners("data");
    };

    const onKey = (data: Buffer) => {
      const ch = data.toString().toLowerCase();

      // Handle Ctrl+C
      if (data[0] === 3) {
        cleanup();
        process.exit(0);
      }

      // "w" = wait: pause timer, switch to blocking
      if (ch === "w" && validKeys.has("w")) {
        if (timer) {
          clearInterval(timer);
          timer = undefined;
        }
        process.stdout.write("\r\x1b[K  Timer paused. Waiting for your choice...\n");
        return;
      }

      if (validKeys.has(ch)) {
        cleanup();
        process.stdout.write(`\r\x1b[K  → ${ch}\n`);
        resolve(ch);
      }
    };

    // Start countdown if timeout > 0
    if (timeoutSec > 0) {
      const barWidth = 20;
      timer = setInterval(() => {
        remaining--;
        const filled = Math.round((remaining / timeoutSec) * barWidth);
        const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
        process.stdout.write(`\r  ${bar} — ${remaining}s remaining  `);

        if (remaining <= 0) {
          cleanup();
          process.stdout.write(`\r\x1b[K  → ${defaultOption.key} (timeout)\n`);
          resolve(defaultOption.key);
        }
      }, 1000);
    }

    // Set up keypress listener
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.on("data", onKey);
    } catch {
      // Fallback: readline
      cleanup();
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("  Choice: ", (answer) => {
        rl.close();
        const ch = answer.trim().toLowerCase();
        resolve(validKeys.has(ch) ? ch : defaultOption.key);
      });
    }
  });

  const timedOut = timeoutSec > 0 && selectedKey === defaultOption.key;

  // If this key triggers text input, prompt for it
  if (textPromptForKey && selectedKey === textPromptForKey) {
    const freeText = await promptFreeText("  Your feedback: ");
    return { key: selectedKey, timedOut: false, freeText };
  }

  return { key: selectedKey, timedOut };
}

async function promptFreeText(prompt: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
