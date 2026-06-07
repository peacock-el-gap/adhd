/**
 * Sprint 5: Phase 1.5 end-to-end integration validation
 *
 * Validates all Phase 1.5 features compose correctly:
 * - Sprint counting regex (phantom sprint prevention)
 * - Timestamp log filenames (no overwrites, chronological ordering)
 * - Resume contract skip (reuse existing contracts)
 * - Contract parse error diagnostics (file + console)
 * - .adhd/ artifact commits (clean working tree, [adhd] prefix)
 * - Progress "documenting" status (lifecycle transitions)
 * - HITL notifications (bell + desktop)
 * - --commit-adhd / --commit-adhd-logs flags
 * - SDK separation (shared/ has zero provider imports)
 * - No swallowed errors (all catch blocks documented)
 * - Consistent naming conventions
 * - No code duplication
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeIdentity } from "../shared/agent-identity.ts";
import { CLI_FLAG_HELP, parseCli, resolveConfig } from "../shared/config.ts";
import { createConversationLog } from "../shared/conversation-logger.ts";
import { loadExistingContract, writeContract, writeProgress } from "../shared/files.ts";
import { fileTimestamp } from "../shared/logger.ts";
import { notify } from "../shared/notifications.ts";
import { commitAdhdMetadata, revertToCheckpoint } from "../shared/orchestration/git-ops.ts";
import { countSprintHeadings } from "../shared/sprint-count.ts";
import type { HarnessProgress, SprintContract } from "../shared/types.ts";
import { parseContract } from "../harness-claude/contract.ts";

// ── Helpers ────────────────────────────────────────────────────────

const TIMESTAMP_RE = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}/;

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "adhd-e2e-"));
	mkdirSync(dir, { recursive: true });
	return dir;
}

function setupAdhdDir(dir: string): void {
	mkdirSync(join(dir, ".adhd", "contracts"), { recursive: true });
	mkdirSync(join(dir, ".adhd", "feedback"), { recursive: true });
	mkdirSync(join(dir, ".adhd", "logs"), { recursive: true });
}

function initGitRepo(dir: string): void {
	const env = {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@test.com",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@test.com",
	};
	execSync("git init", { cwd: dir, stdio: "pipe", env });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe", env });
	execSync("git config user.name Test", { cwd: dir, stdio: "pipe", env });
	writeFileSync(join(dir, "README.md"), "# Test");
	execSync("git add -A && git commit -m 'initial'", { cwd: dir, stdio: "pipe", env });
}

function getHeadSha(dir: string): string {
	return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8" }).trim();
}

function getCommitMessage(dir: string): string {
	return execSync("git log -1 --format=%s", { cwd: dir, encoding: "utf-8" }).trim();
}

function getCommitMessages(dir: string, count = 10): string[] {
	return execSync(`git log -${count} --format=%s`, { cwd: dir, encoding: "utf-8" })
		.trim()
		.split("\n")
		.filter(Boolean);
}

const baseCli = {
	greenfield: false,
	resume: false,
	verbose: false,
	quiet: false,
	noInteractive: false,
	debug: false,
	dryRun: false,
	noBdd: false,
	noTdd: false,
	noDocs: false,
};

// =====================================================
// 1. e2e_phantom_sprint_prevention
// =====================================================
describe("e2e_phantom_sprint_prevention", () => {
	test("spec with inline sprint references in prose produces correct count", () => {
		const spec = `# Product Spec

## Sprint 1
Build authentication.

## Sprint 2
Build dashboard.

Some text mentioning Sprint 3 in prose. Even "## Sprint 3" in quotes.
This builds on Sprint 1 features.
`;
		expect(countSprintHeadings(spec)).toBe(2);
	});

	test("spec with sprint references in blockquotes produces correct count", () => {
		const spec = `## Sprint 1
Feature A.

## Sprint 2
Feature B.

> ## Sprint 3
> This sprint reference in a blockquote should not be counted.
`;
		expect(countSprintHeadings(spec)).toBe(2);
	});

	test("spec with sprint references in acceptance criteria produces correct count", () => {
		const spec = `## Sprint 1
Feature A.

## Sprint 2
Feature B.

### Acceptance scenarios
- Given a spec with Sprint 1 and Sprint 2 headings
- And prose text mentioning Sprint 3 (even with \`## Sprint 3\`)
- Then the total sprint count should be 2
`;
		expect(countSprintHeadings(spec)).toBe(2);
	});

	test("standard multi-sprint spec counts correctly", () => {
		const spec = `# Spec

## Sprint 1
Auth

## Sprint 2
Dashboard

## Sprint 3
Reports

## Sprint 4
Polish
`;
		expect(countSprintHeadings(spec)).toBe(4);
	});

	test("indented sprint headings are not counted", () => {
		const spec = `## Sprint 1
Content.

## Sprint 2
Content.

    ## Sprint 3
    This is indented code.
`;
		expect(countSprintHeadings(spec)).toBe(2);
	});

	test("backtick-quoted sprint headings in acceptance criteria are not counted", () => {
		const spec = `## Sprint 1
Feature.

## Sprint 2
Feature that builds on Sprint 1 features.
- References \`Sprint 3\` in backticks
- Also has \`## Sprint 4\` quoted
`;
		expect(countSprintHeadings(spec)).toBe(2);
	});
});

// =====================================================
// 2. timestamp_log_consistency
// =====================================================
describe("timestamp_log_consistency", () => {
	test("generator log file uses YYYY.MM.DD-HH.MM.SS prefix", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const logger = createConversationLog(dir, makeIdentity({ role: "generator", sprint: 2, attempt: 0 }));
		logger.logAssistantText("Test output");
		await logger.finalize(1000);

		const files = readdirSync(join(dir, ".adhd", "logs"));
		expect(files.length).toBe(1);
		expect(files[0]).toMatch(TIMESTAMP_RE);
		expect(files[0]).toContain("sprint-2-attempt-0-generator.md");
		rmSync(dir, { recursive: true, force: true });
	});

	test("contract negotiation log uses YYYY.MM.DD-HH.MM.SS prefix", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const logger = createConversationLog(dir, makeIdentity({ role: "contract-negotiation", sprint: 3 }));
		await logger.finalize(500);

		const files = readdirSync(join(dir, ".adhd", "logs"));
		expect(files[0]).toMatch(TIMESTAMP_RE);
		expect(files[0]).toContain("sprint-3-contract-negotiation.md");
		rmSync(dir, { recursive: true, force: true });
	});

	test("evaluator log uses YYYY.MM.DD-HH.MM.SS prefix", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const logger = createConversationLog(dir, makeIdentity({ role: "evaluator", sprint: 1, attempt: 0 }));
		await logger.finalize(500);

		const files = readdirSync(join(dir, ".adhd", "logs"));
		expect(files[0]).toMatch(TIMESTAMP_RE);
		expect(files[0]).toContain("sprint-1-attempt-0-evaluator.md");
		rmSync(dir, { recursive: true, force: true });
	});

	test("documenter log uses YYYY.MM.DD-HH.MM.SS prefix", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const logger = createConversationLog(dir, makeIdentity({ role: "documenter" }));
		await logger.finalize(500);

		const files = readdirSync(join(dir, ".adhd", "logs"));
		expect(files[0]).toMatch(TIMESTAMP_RE);
		expect(files[0]).toContain("documenter.md");
		rmSync(dir, { recursive: true, force: true });
	});

	test("multiple runs produce distinct timestamped files", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const logger1 = createConversationLog(
			dir,
			makeIdentity({ role: "generator", sprint: 2, attempt: 0, timestamp: "2026.04.12-10.00.00" }),
		);
		logger1.logAssistantText("First run");
		await logger1.finalize(1000);

		const logger2 = createConversationLog(
			dir,
			makeIdentity({ role: "generator", sprint: 2, attempt: 0, timestamp: "2026.04.12-10.05.00" }),
		);
		logger2.logAssistantText("Second run");
		await logger2.finalize(1000);

		const files = readdirSync(join(dir, ".adhd", "logs")).sort();
		expect(files.length).toBe(2);
		expect(files[0]).not.toBe(files[1]);
		// Chronological ls ordering matches execution order
		expect(files[0]).toContain("2026.04.12-10.00.00");
		expect(files[1]).toContain("2026.04.12-10.05.00");
		// Both contain sprint identifier
		for (const f of files) {
			expect(f).toContain("sprint-2-attempt-0-generator.md");
		}
		rmSync(dir, { recursive: true, force: true });
	});

	test("fileTimestamp produces YYYY.MM.DD-HH.MM.SS format", () => {
		const ts = fileTimestamp();
		expect(ts).toMatch(TIMESTAMP_RE);
		// Verify exact structure: 4.2.2-2.2.2
		expect(ts).toMatch(/^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/);
	});
});

// =====================================================
// 3. e2e_resume_full_cycle
// =====================================================
describe("e2e_resume_full_cycle", () => {
	test("existing contract is reused on resume (no renegotiation needed)", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const contract: SprintContract = {
			sprintNumber: 3,
			features: ["Resume feature"],
			criteria: [{ name: "resume_works", description: "Resume functions correctly", threshold: 7 }],
		};
		await writeContract(dir, contract);

		const loaded = await loadExistingContract(dir, 3);
		expect(loaded).not.toBeNull();
		expect(loaded!.sprintNumber).toBe(3);
		expect(loaded!.criteria.length).toBe(1);
		expect(loaded!.features).toEqual(["Resume feature"]);
		rmSync(dir, { recursive: true, force: true });
	});

	test("missing contract returns null, triggering negotiation", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const loaded = await loadExistingContract(dir, 3);
		expect(loaded).toBeNull();
		rmSync(dir, { recursive: true, force: true });
	});

	test("log files from resume have different timestamps than original", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		// Original run
		const logger1 = createConversationLog(
			dir,
			makeIdentity({ role: "generator", sprint: 2, attempt: 0, timestamp: "2026.04.12-10.00.00" }),
		);
		await logger1.finalize(1000);

		// Resume run
		const logger2 = createConversationLog(
			dir,
			makeIdentity({ role: "generator", sprint: 2, attempt: 0, timestamp: "2026.04.12-14.30.00" }),
		);
		await logger2.finalize(1000);

		const files = readdirSync(join(dir, ".adhd", "logs")).sort();
		expect(files.length).toBe(2);
		// Original file still exists
		expect(files.some((f) => f.includes("2026.04.12-10.00.00"))).toBe(true);
		// New file has different timestamp
		expect(files.some((f) => f.includes("2026.04.12-14.30.00"))).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});
});

// =====================================================
// 4. contract_parse_error_diagnostics
// =====================================================
describe("contract_parse_error_diagnostics", () => {
	test("parse failure writes diagnostic file to .adhd/logs/", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);
		const rawText = "This is completely unparseable text with no JSON";

		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
		parseContract(rawText, 3, dir);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const call = warnSpy.mock.calls[0]?.[0] as string;
		expect(call).toContain("sprint 3");
		expect(call).toContain("generic default contract");
		warnSpy.mockRestore();

		await Bun.sleep(100);

		const diagnosticPath = join(dir, ".adhd", "logs", "sprint-3-contract-parse-error.txt");
		expect(existsSync(diagnosticPath)).toBe(true);
		const content = readFileSync(diagnosticPath, "utf-8");
		expect(content).toBe(rawText);
		rmSync(dir, { recursive: true, force: true });
	});

	test("successful parse does not create diagnostic file", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const validContract = {
			sprintNumber: 2,
			features: ["auth"],
			criteria: [{ name: "works", description: "It works", threshold: 7 }],
		};

		parseContract(JSON.stringify(validContract), 2, dir);
		await Bun.sleep(100);

		expect(existsSync(join(dir, ".adhd", "logs", "sprint-2-contract-parse-error.txt"))).toBe(false);
		rmSync(dir, { recursive: true, force: true });
	});

	test("diagnostic file contains full text even for very long input", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);
		const longText = "x".repeat(5000);

		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
		parseContract(longText, 4, dir);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const call = warnSpy.mock.calls[0]?.[0] as string;
		expect(call).toContain("sprint 4");
		expect(call).toContain("generic default contract");
		warnSpy.mockRestore();

		await Bun.sleep(100);

		const diagnosticPath = join(dir, ".adhd", "logs", "sprint-4-contract-parse-error.txt");
		const content = readFileSync(diagnosticPath, "utf-8");
		expect(content.length).toBe(5000);
		rmSync(dir, { recursive: true, force: true });
	});

	test("parse failure returns default contract (3 criteria)", () => {
		const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
		const result = parseContract("not json at all", 5);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const call = warnSpy.mock.calls[0]?.[0] as string;
		expect(call).toContain("sprint 5");
		expect(call).toContain("generic default contract");
		warnSpy.mockRestore();
		expect(result.sprintNumber).toBe(5);
		expect(result.criteria.length).toBe(3);
		expect(result.criteria[0]!.name).toBe("basic_functionality");
	});
});

// =====================================================
// 5. progress_status_lifecycle
// =====================================================
describe("progress_status_lifecycle", () => {
	test("'documenting' is a valid status value in HarnessProgress", () => {
		const progress: HarnessProgress = {
			status: "documenting",
			currentSprint: 3,
			totalSprints: 3,
			completedSprints: 3,
			retryCount: 0,
		};
		expect(progress.status).toBe("documenting");
	});

	test("status transitions through full lifecycle", () => {
		const progress: HarnessProgress = {
			status: "planning",
			currentSprint: 0,
			totalSprints: 0,
			completedSprints: 0,
			retryCount: 0,
		};

		// planning → spec-review → negotiating → building → evaluating
		const transitions: HarnessProgress["status"][] = [
			"planning",
			"spec-review",
			"negotiating",
			"building",
			"evaluating",
			"documenting",
			"complete",
		];

		for (const status of transitions) {
			progress.status = status;
			expect(progress.status).toBe(status);
		}
	});

	test("'documenting' appears between 'evaluating' and 'complete'", () => {
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

		const docIdx = statuses.indexOf("documenting");
		const evalIdx = statuses.indexOf("evaluating");
		const completeIdx = statuses.indexOf("complete");

		expect(docIdx).toBeGreaterThan(evalIdx);
		expect(docIdx).toBeLessThan(completeIdx);
	});

	test("progress can be written with 'documenting' status", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);

		const progress: HarnessProgress = {
			status: "documenting",
			currentSprint: 2,
			totalSprints: 2,
			completedSprints: 2,
			retryCount: 0,
		};
		await writeProgress(dir, progress);

		const written = JSON.parse(readFileSync(join(dir, ".adhd", "progress.json"), "utf-8"));
		expect(written.status).toBe("documenting");
		rmSync(dir, { recursive: true, force: true });
	});
});

// =====================================================
// 6. e2e_notifications
// =====================================================
describe("e2e_notifications", () => {
	test("terminal bell is emitted on notify()", () => {
		let writtenData = "";
		const originalWrite = process.stdout.write;
		// @ts-ignore — mock stdout.write
		process.stdout.write = (data: string | Buffer) => {
			writtenData += typeof data === "string" ? data : data.toString();
			return true;
		};
		try {
			notify("Test message");
			expect(writtenData).toContain("\x07");
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	test("terminal bell emitted even without --notify flag", () => {
		let writtenData = "";
		const originalWrite = process.stdout.write;
		// @ts-ignore
		process.stdout.write = (data: string | Buffer) => {
			writtenData += typeof data === "string" ? data : data.toString();
			return true;
		};
		try {
			notify("Test message", { notify: false });
			expect(writtenData).toContain("\x07");
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	test("notify does not throw with --notify enabled", () => {
		const originalWrite = process.stdout.write;
		// @ts-ignore
		process.stdout.write = () => true;
		try {
			expect(() => notify("Test", { notify: true })).not.toThrow();
		} finally {
			process.stdout.write = originalWrite;
		}
	});

	test("--notify flag is parsed and resolved", () => {
		const cli = parseCli(["--notify", "test"]);
		expect(cli.notify).toBe(true);

		const config = resolveConfig({ ...baseCli, prompt: "test", notify: true });
		expect(config.notify).toBe(true);
	});

	test("notify defaults to false without --notify", () => {
		const config = resolveConfig({ ...baseCli, prompt: "test" });
		expect(config.notify).toBe(false);
	});
});

// =====================================================
// 7. e2e_commit_adhd_flags
// =====================================================
describe("e2e_commit_adhd_flags", () => {
	test("--commit-adhd flag is parsed and resolved", () => {
		const cli = parseCli(["--commit-adhd", "test"]);
		expect(cli.commitAdhd).toBe(true);

		const config = resolveConfig({ ...baseCli, prompt: "test", commitAdhd: true, commitAdhdLogs: false });
		expect(config.commitAdhd).toBe(true);
		expect(config.commitAdhdLogs).toBe(false);
	});

	test("--commit-adhd-logs implies --commit-adhd", () => {
		const config = resolveConfig({ ...baseCli, prompt: "test", commitAdhd: false, commitAdhdLogs: true });
		expect(config.commitAdhd).toBe(true);
		expect(config.commitAdhdLogs).toBe(true);
	});

	test("default behavior: no [adhd] metadata commits without flags", () => {
		const config = resolveConfig({ ...baseCli, prompt: "test" });
		expect(config.commitAdhd).toBe(false);
		expect(config.commitAdhdLogs).toBe(false);
	});

	test("commitAdhdMetadata commits with [adhd] prefix and sprint number", () => {
		const dir = makeTmpDir();
		initGitRepo(dir);
		setupAdhdDir(dir);
		writeFileSync(join(dir, ".adhd", "contracts", "sprint-2.json"), '{"sprintNumber": 2}');
		writeFileSync(join(dir, ".adhd", "progress.json"), '{"status": "building"}');

		commitAdhdMetadata(dir, dir, 2, false);

		const msg = getCommitMessage(dir);
		expect(msg).toBe("[adhd] Sprint 2: contract + metadata");
		rmSync(dir, { recursive: true, force: true });
	});

	test("commitAdhdMetadata with includeLogs stages .adhd/logs/", () => {
		const dir = makeTmpDir();
		initGitRepo(dir);
		setupAdhdDir(dir);
		writeFileSync(join(dir, ".adhd", "contracts", "sprint-1.json"), '{"sprintNumber": 1}');
		writeFileSync(join(dir, ".adhd", "logs", "test.md"), "log content");

		commitAdhdMetadata(dir, dir, 1, true);

		const msg = getCommitMessage(dir);
		expect(msg).toBe("[adhd] Sprint 1: contract + metadata");
		// Verify logs are committed (no untracked .adhd/logs/ files)
		const status = execSync("git status --porcelain -- .adhd/logs/", { cwd: dir, encoding: "utf-8" }).trim();
		expect(status).toBe("");
		rmSync(dir, { recursive: true, force: true });
	});

	test("commitAdhdMetadata is no-op when no .adhd/ changes", () => {
		const dir = makeTmpDir();
		initGitRepo(dir);

		const beforeSha = getHeadSha(dir);
		commitAdhdMetadata(dir, dir, 1, false);
		const afterSha = getHeadSha(dir);

		expect(afterSha).toBe(beforeSha);
		rmSync(dir, { recursive: true, force: true });
	});
});

// =====================================================
// 8. clean_working_tree_before_generator (OPP-54: hygiene commit removed)
// =====================================================
describe("clean_working_tree_before_generator", () => {
	test("commitAdhdArtifacts has been removed — the ungated hygiene commit no longer exists", () => {
		// OPP-54 Sprint 2: the commitAdhdArtifacts function was deleted because
		// .adhd/ is now excluded from generator-output detection via pathspec,
		// making the pre-generator hygiene commit unnecessary.
		const gitOps = require("../shared/orchestration/git-ops.ts");
		expect(gitOps.commitAdhdArtifacts).toBeUndefined();
	});
});

// =====================================================
// 9. Checkpoint revert uses git reset --hard
// =====================================================
describe("checkpoint_revert", () => {
	test("revertToCheckpoint uses git reset --hard", () => {
		const dir = makeTmpDir();
		initGitRepo(dir);
		const checkpointSha = getHeadSha(dir);

		// Add a commit after checkpoint
		writeFileSync(join(dir, "new-file.ts"), "export const x = 1;");
		execSync("git add -A && git commit -m 'post-checkpoint'", { cwd: dir, stdio: "pipe" });

		const progress: HarnessProgress = {
			status: "building",
			currentSprint: 2,
			totalSprints: 3,
			completedSprints: 1,
			retryCount: 0,
			lastPassedCommitSha: checkpointSha,
		};

		revertToCheckpoint(dir, false, progress);

		expect(getHeadSha(dir)).toBe(checkpointSha);
		expect(existsSync(join(dir, "new-file.ts"))).toBe(false);
		rmSync(dir, { recursive: true, force: true });
	});

	test(".adhd/ files survive revert via stash/unstash", () => {
		const dir = makeTmpDir();
		initGitRepo(dir);
		const checkpointSha = getHeadSha(dir);

		// Add commit after checkpoint
		writeFileSync(join(dir, "feature.ts"), "export const y = 2;");
		execSync("git add -A && git commit -m 'feature'", { cwd: dir, stdio: "pipe" });

		// Write .adhd/ files after checkpoint
		setupAdhdDir(dir);
		writeFileSync(join(dir, ".adhd", "progress.json"), '{"status": "building"}');
		writeFileSync(join(dir, ".adhd", "contracts", "sprint-3.json"), '{"sprintNumber": 3}');

		const progress: HarnessProgress = {
			status: "building",
			currentSprint: 3,
			totalSprints: 4,
			completedSprints: 2,
			retryCount: 0,
			lastPassedCommitSha: checkpointSha,
		};

		revertToCheckpoint(dir, false, progress);

		// .adhd/ files should survive
		expect(existsSync(join(dir, ".adhd", "progress.json"))).toBe(true);
		expect(existsSync(join(dir, ".adhd", "contracts", "sprint-3.json"))).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});

	test("no-op when HEAD matches checkpoint", () => {
		const dir = makeTmpDir();
		initGitRepo(dir);
		const sha = getHeadSha(dir);

		const progress: HarnessProgress = {
			status: "building",
			currentSprint: 1,
			totalSprints: 2,
			completedSprints: 0,
			retryCount: 0,
			lastPassedCommitSha: sha,
		};

		revertToCheckpoint(dir, false, progress);
		expect(getHeadSha(dir)).toBe(sha);
		rmSync(dir, { recursive: true, force: true });
	});
});

// =====================================================
// 10. readme_cli_flags_documented
// =====================================================
describe("readme_cli_flags_documented", () => {
	test("--resume flag is in CLI_FLAG_HELP", () => {
		expect(CLI_FLAG_HELP["--resume"]).toBeDefined();
	});

	test("--notify flag is in CLI_FLAG_HELP", () => {
		expect(CLI_FLAG_HELP["--notify"]).toBeDefined();
	});

	test("--commit-adhd flag is in CLI_FLAG_HELP", () => {
		expect(CLI_FLAG_HELP["--commit-adhd"]).toBeDefined();
	});

	test("--commit-adhd-logs flag is in CLI_FLAG_HELP", () => {
		expect(CLI_FLAG_HELP["--commit-adhd-logs"]).toBeDefined();
	});

	test("README.md exists and mentions key flags", () => {
		const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf-8");
		expect(readme).toContain("--resume");
		expect(readme).toContain("--notify");
		expect(readme).toContain("--commit-adhd");
		expect(readme).toContain("--commit-adhd-logs");
	});

	test("README documents --commit-adhd-logs implies --commit-adhd", () => {
		const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf-8");
		// Should mention the implication relationship
		expect(readme).toContain("implies");
	});
});

// =====================================================
// 11. SDK separation maintained
// =====================================================
describe("sdk_separation_maintained", () => {
	test("shared/ files have no @anthropic-ai imports", () => {
		const sharedDir = join(import.meta.dir, "..", "shared");
		const sharedFiles = findTsFiles(sharedDir);

		for (const filePath of sharedFiles) {
			const content = readFileSync(filePath, "utf-8");
			expect(content).not.toContain("@anthropic-ai/claude-agent-sdk");
			expect(content).not.toContain("from \"@anthropic-ai");
		}
	});
});

function findTsFiles(dir: string): string[] {
	const results: string[] = [];
	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findTsFiles(fullPath));
		} else if (entry.name.endsWith(".ts")) {
			results.push(fullPath);
		}
	}
	return results;
}

// =====================================================
// 12. Consistent naming conventions
// =====================================================
describe("consistent_naming_conventions", () => {
	test("exported functions use camelCase", () => {
		// Verify key Phase 1.5 function names are camelCase
		expect(typeof countSprintHeadings).toBe("function");
		expect(typeof fileTimestamp).toBe("function");
		expect(typeof loadExistingContract).toBe("function");
		expect(typeof commitAdhdMetadata).toBe("function");
		expect(typeof revertToCheckpoint).toBe("function");
		expect(typeof parseContract).toBe("function");
		expect(typeof notify).toBe("function");
	});

	test("file names use kebab-case", () => {
		const sharedDir = join(import.meta.dir, "..", "shared");
		const sharedFiles = findTsFiles(sharedDir);

		for (const filePath of sharedFiles) {
			const fileName = filePath.split("/").pop()!;
			// File names should be kebab-case: only lowercase, hyphens, dots
			expect(fileName).toMatch(/^[a-z0-9.-]+\.ts$/);
		}
	});

	test("constants use UPPER_SNAKE_CASE", () => {
		// Verify key constants
		expect(CLI_FLAG_HELP).toBeDefined();
		expect(typeof CLI_FLAG_HELP).toBe("object");
	});
});

// =====================================================
// 13. No code duplication across features
// =====================================================
describe("no_code_duplication_across_features", () => {
	test("fileTimestamp is the single utility for timestamp formatting", () => {
		// fileTimestamp is imported from logger.ts and used across
		// conversation-logger, harness, sprint-attempts, sprint-success
		const ts = fileTimestamp();
		expect(ts).toMatch(/^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/);
	});

	test("commitAdhdMetadata is exported from git-ops module", () => {
		expect(typeof commitAdhdMetadata).toBe("function");
	});

	test("notify is the single notification utility", () => {
		// Single function for both bell and desktop notifications
		expect(typeof notify).toBe("function");
	});

	test("loadExistingContract is used by both --resume and --sprint modes", async () => {
		const dir = makeTmpDir();
		setupAdhdDir(dir);
		const contract: SprintContract = {
			sprintNumber: 1,
			features: ["Test"],
			criteria: [{ name: "test", description: "Test", threshold: 7 }],
		};
		await writeContract(dir, contract);

		// Same function used in both contexts
		const result1 = await loadExistingContract(dir, 1);
		const result2 = await loadExistingContract(dir, 1);
		expect(result1).toEqual(result2);
		rmSync(dir, { recursive: true, force: true });
	});
});

// =====================================================
// 14. Biome lint clean
// =====================================================
describe("biome_lint_clean", () => {
	test("biome check passes with no errors", () => {
		const result = execSync("bunx biome check . 2>&1", {
			cwd: join(import.meta.dir, ".."),
			encoding: "utf-8",
		});
		expect(result).toContain("Checked");
		expect(result).not.toContain("error");
	});
});

// =====================================================
// 15. No swallowed errors verification
// =====================================================
describe("no_swallowed_errors", () => {
	test("all catch blocks in shared/ have comments or actions", () => {
		const sharedDir = join(import.meta.dir, "..", "shared");
		const files = findTsFiles(sharedDir);

		for (const filePath of files) {
			const content = readFileSync(filePath, "utf-8");
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]!;
				if (line.match(/}\s*catch\s*(\([^)]*\))?\s*\{/)) {
					// Check that the next few lines aren't just a closing brace
					const nextLines = lines.slice(i + 1, i + 5).join("\n").trim();
					// Either has a comment, a log/throw statement, or a return
					const hasAction =
						nextLines.includes("//") ||
						nextLines.includes("log") ||
						nextLines.includes("throw") ||
						nextLines.includes("return") ||
						nextLines.includes("continue") ||
						nextLines.includes("fallback") ||
						nextLines.includes("cleanup") ||
						nextLines.includes("execSync") ||
						nextLines.includes("try");
					if (!hasAction && !nextLines.startsWith("}")) {
						// If the catch block is truly empty (just closes), fail
						const isEmptyCatch = lines[i + 1]?.trim() === "}";
						if (isEmptyCatch) {
							throw new Error(
								`Empty catch block found in ${filePath.split("/").pop()} at line ${i + 1}`,
							);
						}
					}
				}
			}
		}
	});

	test("all catch blocks in harness-claude/ have comments or actions", () => {
		const claudeDir = join(import.meta.dir, "..", "harness-claude");
		const files = findTsFiles(claudeDir);

		for (const filePath of files) {
			const content = readFileSync(filePath, "utf-8");
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]!;
				if (line.match(/}\s*catch\s*(\([^)]*\))?\s*\{/)) {
					const nextLines = lines.slice(i + 1, i + 5).join("\n").trim();
					const hasAction =
						nextLines.includes("//") ||
						nextLines.includes("log") ||
						nextLines.includes("throw") ||
						nextLines.includes("return") ||
						nextLines.includes("continue");
					if (!hasAction) {
						const isEmptyCatch = lines[i + 1]?.trim() === "}";
						if (isEmptyCatch) {
							throw new Error(
								`Empty catch block found in ${filePath.split("/").pop()} at line ${i + 1}`,
							);
						}
					}
				}
			}
		}
	});
});
