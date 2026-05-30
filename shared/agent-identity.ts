import { fileTimestamp } from "./logger.ts";

/**
 * The identity of one agent run. Built once by whoever calls the agent run,
 * then passed wherever a name is needed: trace span, cost row, conversation log.
 *
 * The timestamp is generated at construction so the trace span name and the
 * conversation log filename — which both use the timestamped form — pair by
 * sharing it. The cost row uses the bare form (no timestamp), since the cost
 * spreadsheet has its own time column.
 *
 * The role is a free-form string. Standard values: "planner", "generator",
 * "evaluator", "documenter", "contract-proposal", "contract-review",
 * "contract-negotiation" (used for the shared negotiation conversation log).
 *
 * The variant is for cases where the same role runs in a different mode —
 * currently only "revision" for the planner re-running with revise feedback.
 */
export interface AgentIdentity {
  readonly role: string;
  readonly sprint?: number;
  readonly attempt?: number;
  readonly variant?: string;
  readonly timestamp: string;
}

export interface MakeIdentityInput {
  role: string;
  sprint?: number;
  attempt?: number;
  variant?: string;
  timestamp?: string;
}

export function makeIdentity(input: MakeIdentityInput): AgentIdentity {
  return {
    role: input.role,
    sprint: input.sprint,
    attempt: input.attempt,
    variant: input.variant,
    timestamp: input.timestamp ?? fileTimestamp(),
  };
}

/**
 * The bare name for an agent run — used for cost-tracking row names where
 * timestamps live in a separate column.
 *
 * Format:
 *   - sprint + attempt + role           → `sprint-N-attempt-M-role`
 *   - sprint + role                     → `sprint-N-role`
 *   - role only                         → `role`
 *   - any of the above + variant suffix → `…-variant`
 */
export function bareName(identity: AgentIdentity): string {
  const variantSuffix = identity.variant ? `-${identity.variant}` : "";

  if (identity.sprint != null && identity.attempt != null) {
    return `sprint-${identity.sprint}-attempt-${identity.attempt}-${identity.role}${variantSuffix}`;
  }
  if (identity.sprint != null) {
    return `sprint-${identity.sprint}-${identity.role}${variantSuffix}`;
  }
  return `${identity.role}${variantSuffix}`;
}

/**
 * The timestamped name — used for trace spans and conversation log filenames,
 * where the timestamp ensures uniqueness across runs and pairs the trace with
 * its log file.
 */
export function timedName(identity: AgentIdentity): string {
  return `${identity.timestamp}-${bareName(identity)}`;
}

/**
 * Human-readable title for the conversation log markdown body. Capitalises
 * the role and appends sprint/attempt/variant context when present.
 */
export function displayTitle(identity: AgentIdentity): string {
  const titleRole = identity.role
    .split("-")
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
  const variantSuffix = identity.variant ? ` (${identity.variant})` : "";

  if (identity.sprint != null && identity.attempt != null) {
    return `${titleRole}${variantSuffix} — Sprint ${identity.sprint}, Attempt ${identity.attempt}`;
  }
  if (identity.sprint != null) {
    return `${titleRole}${variantSuffix} — Sprint ${identity.sprint}`;
  }
  return `${titleRole}${variantSuffix}`;
}
