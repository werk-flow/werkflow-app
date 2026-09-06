import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeJsonAtomically } from "./file-lock";
import type { PlaywrightSuite, PlaywrightTarget } from "./run-policy";
import { z } from "zod";

export type CampaignAttempt = {
  runKey: string;
  campaignId?: string;
  lane: string;
  suite: PlaywrightSuite;
  target?: PlaywrightTarget;
  startedAt: string;
  completedAt: string | null;
};
type RerunGrant = {
  id: string;
  referenceRunKey: string;
  suite: PlaywrightSuite;
  target: PlaywrightTarget;
  candidateFingerprint: string;
  reason: string;
  issuedAt: string;
  consumedBy: string | null;
};
export type RunCampaign = {
  id: string;
  name: string;
  startedAt: string;
  closedAt: string | null;
  grants: RerunGrant[];
};
type CampaignRegistry = { version: 1; campaigns: RunCampaign[] };
const REGISTRY_PATH = resolve(import.meta.dir, "../../.agent-logs/playwright-campaigns.json");
const registrySchema: z.ZodType<CampaignRegistry> = z.object({
  version: z.literal(1),
  campaigns: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), startedAt: z.string(), closedAt: z.string().nullable(),
    grants: z.array(z.object({
      id: z.string().min(1), referenceRunKey: z.string().min(1), suite: z.enum(["golden", "audit", "canary"]), target: z.enum(["local", "cloud"]),
      candidateFingerprint: z.string().min(1), reason: z.string().min(20), issuedAt: z.string(), consumedBy: z.string().nullable(),
    })),
  })),
});

export function readCampaigns(path = REGISTRY_PATH): RunCampaign[] {
  if (!existsSync(path)) return [];
  const registry = registrySchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return registry.campaigns;
}

export function activeCampaign(path = REGISTRY_PATH): RunCampaign {
  const campaigns = readCampaigns(path);
  const active = campaigns.find((campaign) => !campaign.closedAt);
  if (active) return active;
  const campaign: RunCampaign = { id: randomUUID(), name: "Browser verification", startedAt: new Date().toISOString(), closedAt: null, grants: [] };
  writeJsonAtomically(path, { version: 1, campaigns: [...campaigns, campaign] });
  return campaign;
}

export function campaignSummary(campaign: RunCampaign, attempts: readonly CampaignAttempt[], now = Date.now()): { fullAttempts: number; fullMinutes: number; totalMinutes: number; diagnosticMinutes: number } {
  const campaignAttempts = attempts.filter((attempt) => attempt.campaignId === campaign.id);
  const minutes = (selection: readonly CampaignAttempt[]): number => selection.reduce((total, attempt) => total + Math.max(0, (attempt.completedAt ? Date.parse(attempt.completedAt) : now) - Date.parse(attempt.startedAt)) / 60_000, 0);
  const full = campaignAttempts.filter((attempt) => attempt.lane === "certification");
  return { fullAttempts: full.length, fullMinutes: minutes(full), totalMinutes: minutes(campaignAttempts), diagnosticMinutes: minutes(campaignAttempts.filter((attempt) => attempt.lane === "diagnostic")) };
}

export function campaignBudgetProblem(input: { campaign: RunCampaign; attempts: readonly CampaignAttempt[]; suite: PlaywrightSuite; target: PlaywrightTarget; now?: number }): string | null {
  const matching = input.attempts.filter((attempt) => attempt.campaignId === input.campaign.id && attempt.lane === "certification" && attempt.suite === input.suite && attempt.target === input.target);
  const summary = campaignSummary(input.campaign, input.attempts, input.now);
  if (matching.length >= 2 || summary.fullMinutes >= 120) return `Campaign ${input.campaign.id} has consumed ${matching.length} ${input.suite}/${input.target} complete attempts and ${summary.fullMinutes.toFixed(1)} total complete-run minutes. Default limits are 2 attempts per suite/target and 120 cumulative minutes. Diagnose the recorded boundary, then issue a single-use grant with test:runs campaign-extend.`;
  return null;
}

/** A first baseline may need a grant after another suite consumed the shared budget. */
export function grantReferenceRunKey(input: { attempts: readonly CampaignAttempt[]; campaignId: string; suite: PlaywrightSuite; target: PlaywrightTarget; lane: string }): string | null {
  const completed = input.attempts.filter((attempt) => attempt.campaignId === input.campaignId && attempt.completedAt);
  return (completed.filter((attempt) => attempt.suite === input.suite && attempt.target === input.target && attempt.lane === input.lane).at(-1) ?? completed.at(-1))?.runKey ?? null;
}

export function issueRerunGrant(input: { campaignId: string; referenceRunKey: string; suite: PlaywrightSuite; target: PlaywrightTarget; candidateFingerprint: string; reason: string }, path = REGISTRY_PATH): string {
  if (input.reason.trim().length < 20) throw new Error("A rerun grant needs a concrete investigated reason of at least 20 characters.");
  const campaigns = readCampaigns(path);
  const campaign = campaigns.find((candidate) => candidate.id === input.campaignId && !candidate.closedAt);
  if (!campaign) throw new Error("Rerun grants require the active campaign.");
  const id = randomUUID();
  campaign.grants.push({ ...input, id, issuedAt: new Date().toISOString(), consumedBy: null });
  writeJsonAtomically(path, { version: 1, campaigns });
  return id;
}

export function validatedRerunGrant(input: { campaign: RunCampaign; grantId: string | null; suite: PlaywrightSuite; target: PlaywrightTarget; candidateFingerprint: string; latestRunKey: string | null }): RerunGrant | null {
  if (!input.grantId) return null;
  const grant = input.campaign.grants.find((candidate) => candidate.id === input.grantId);
  if (!grant || grant.consumedBy || grant.suite !== input.suite || grant.target !== input.target || grant.candidateFingerprint !== input.candidateFingerprint || grant.referenceRunKey !== input.latestRunKey) throw new Error("Rerun grant is missing, consumed, stale, or belongs to a different suite, target or source. Review the latest run and issue one new explicit grant.");
  return grant;
}

export function consumeRerunGrant(campaignId: string, grantId: string, runKey: string, path = REGISTRY_PATH): void {
  const campaigns = readCampaigns(path);
  const grant = campaigns.find((campaign) => campaign.id === campaignId)?.grants.find((candidate) => candidate.id === grantId);
  if (!grant || grant.consumedBy) throw new Error("Rerun grant was already consumed or does not exist.");
  grant.consumedBy = runKey;
  writeJsonAtomically(path, { version: 1, campaigns });
}

export function closeCampaign(id: string, path = REGISTRY_PATH): void {
  const campaigns = readCampaigns(path);
  const campaign = campaigns.find((candidate) => candidate.id === id && !candidate.closedAt);
  if (!campaign) throw new Error("Campaign is not active.");
  campaign.closedAt = new Date().toISOString();
  writeJsonAtomically(path, { version: 1, campaigns });
}
