import { describe, expect, test } from "bun:test";
import type { HarnessProgress } from "../shared/types.ts";

// =====================================================
// Feature: Progress "documenting" Status
// =====================================================

describe("HarnessProgress status type includes 'documenting'", () => {
  test("'documenting' is a valid status value", () => {
    const progress: HarnessProgress = {
      status: "documenting",
      currentSprint: 3,
      totalSprints: 3,
      completedSprints: 3,
      retryCount: 0,
    };
    expect(progress.status).toBe("documenting");
  });

  test("status transitions: building -> documenting -> complete", () => {
    const progress: HarnessProgress = {
      status: "building",
      currentSprint: 2,
      totalSprints: 2,
      completedSprints: 1,
      retryCount: 0,
    };

    // Simulate transition to documenting
    progress.status = "documenting";
    expect(progress.status).toBe("documenting");

    // Simulate transition to complete
    progress.status = "complete";
    expect(progress.status).toBe("complete");
  });

  test("all existing status values still valid alongside documenting", () => {
    const statuses: HarnessProgress["status"][] = [
      "planning",
      "spec-review",
      "negotiating",
      "building",
      "evaluating",
      "documenting",
      "complete",
      "failed",
    ];

    for (const status of statuses) {
      const progress: HarnessProgress = {
        status,
        currentSprint: 1,
        totalSprints: 1,
        completedSprints: 0,
        retryCount: 0,
      };
      expect(progress.status).toBe(status);
    }
  });
});
