import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { notify } from "../shared/notifications.ts";

describe("notify", () => {
  let writtenData: string;
  const originalWrite = process.stdout.write;

  beforeEach(() => {
    writtenData = "";
    // @ts-ignore — mock stdout.write to capture bell characters
    process.stdout.write = (data: string | Buffer) => {
      writtenData += typeof data === "string" ? data : data.toString();
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  test("emits terminal bell character", () => {
    notify("Test message");
    expect(writtenData).toContain("\x07");
  });

  test("emits terminal bell even without notify option", () => {
    notify("Test message", { notify: false });
    expect(writtenData).toContain("\x07");
  });

  test("emits terminal bell with notify option", () => {
    notify("Test message", { notify: true });
    expect(writtenData).toContain("\x07");
  });

  test("does not throw on unsupported platform", () => {
    // notify with desktop notification on the current platform should not throw
    expect(() => notify("Test", { notify: true })).not.toThrow();
  });

  test("accepts custom title", () => {
    expect(() => notify("Test", { notify: false, title: "Custom Title" })).not.toThrow();
  });
});
