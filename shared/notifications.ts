import { exec } from "node:child_process";
import { logDebug } from "./logger.ts";

/**
 * Send a notification to the user via terminal bell and optional desktop notification.
 *
 * Terminal bell (\x07) is always emitted to stdout.
 * Desktop notifications are only sent when `notify` is true, using
 * the platform-appropriate command (notify-send on Linux, osascript on macOS).
 * Unsupported platforms are silently ignored.
 * Subprocess failures (e.g., notify-send not installed) are logged as warnings, not fatal errors.
 *
 * @param message - Descriptive message for the notification
 * @param options.notify - Whether to send a desktop notification (from --notify flag)
 * @param options.title - Optional title for the desktop notification (defaults to "ADHD Harness")
 */
export function notify(
  message: string,
  options: { notify?: boolean; title?: string } = {},
): void {
  const { notify: sendDesktop = false, title = "ADHD Harness" } = options;

  // Always emit terminal bell
  process.stdout.write("\x07");

  // Desktop notification only when --notify is enabled
  if (sendDesktop) {
    sendDesktopNotification(title, message);
  }
}

/**
 * Send a desktop notification using the platform-appropriate command.
 * Failures are caught and logged as debug warnings, never thrown.
 */
function sendDesktopNotification(title: string, message: string): void {
  const platform = process.platform;

  let cmd: string;
  if (platform === "linux") {
    cmd = `notify-send ${escapeShellArg(title)} ${escapeShellArg(message)}`;
  } else if (platform === "darwin") {
    cmd = `osascript -e 'display notification ${escapeAppleScript(message)} with title ${escapeAppleScript(title)}'`;
  } else {
    // Unsupported platform — no-op
    logDebug("HARNESS", `Desktop notifications not supported on platform: ${platform}`);
    return;
  }

  exec(cmd, (err) => {
    if (err) {
      logDebug("HARNESS", `Desktop notification failed: ${err.message}`);
    }
  });
}

/** Escape a string for safe use in a shell argument (single-quoted). */
function escapeShellArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Escape a string for use inside AppleScript single-quoted string. */
function escapeAppleScript(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
