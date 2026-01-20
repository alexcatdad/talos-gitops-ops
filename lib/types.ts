import { z } from "zod";

// Node definition
export const NodeSchema = z.object({
  name: z.string(),
  ip: z.string().ip(),
  role: z.enum(["control-plane", "worker"]),
});
export type Node = z.infer<typeof NodeSchema>;

// Chart reference
export const ChartRefSchema = z.object({
  repo: z.string().url(),
  name: z.string(),
  version: z.string(),
});
export type ChartRef = z.infer<typeof ChartRefSchema>;

// App definition parsed from GitOps repo
export const AppDefinitionSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  chart: ChartRefSchema,
  valuesPath: z.string(),
  hasTolerations: z.boolean(),
  psaLevel: z.enum(["privileged", "baseline", "restricted"]).nullable(),
  ignoreDifferences: z.boolean(),
});
export type AppDefinition = z.infer<typeof AppDefinitionSchema>;

// Full cluster context auto-detected from repo
export const ClusterContextSchema = z.object({
  name: z.string(),
  omniEndpoint: z.string().url().optional(),
  nodes: z.array(NodeSchema),
  domain: z.string().optional(),
  apps: z.map(z.string(), AppDefinitionSchema),
  repoRoot: z.string(),
});
export type ClusterContext = z.infer<typeof ClusterContextSchema>;

// Validation error
export const ValidationErrorSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  fix: z.string().optional(),
});
export type ValidationError = z.infer<typeof ValidationErrorSchema>;

// Validation result
export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(ValidationErrorSchema),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// Session state for tracking dry-runs
export const SessionStateSchema = z.object({
  validatedApps: z.set(z.string()),
  validatedFiles: z.set(z.string()),
  pendingSync: z.string().nullable(),
  loopDetection: z.map(z.string(), z.number()),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// Hook input from Claude Code
export const HookInputSchema = z.object({
  tool_name: z.string(),
  tool_input: z.record(z.unknown()),
});
export type HookInput = z.infer<typeof HookInputSchema>;

// Hook output to Claude Code
export const HookOutputSchema = z.object({
  hookSpecificOutput: z.object({
    hookEventName: z.enum(["PreToolUse", "PostToolUse"]),
    permissionDecision: z.enum(["allow", "deny", "ask"]),
    permissionDecisionReason: z.string().optional(),
  }),
});
export type HookOutput = z.infer<typeof HookOutputSchema>;

// Helper to create hook responses
export const hookResponse = {
  allow: (): HookOutput => ({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  }),

  deny: (reason: string): HookOutput => ({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }),

  ask: (reason: string): HookOutput => ({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  }),
};
