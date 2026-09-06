import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activeCampaign, campaignBudgetProblem, consumeRerunGrant, grantReferenceRunKey, issueRerunGrant, readCampaigns, validatedRerunGrant } from "./run-campaign";

describe("persistent browser campaign budget", () => {
  test("does not reset the budget across passing runs or alternating failure causes", () => {
    const campaign = { id: "campaign", name: "handoff", startedAt: "2026-09-05T10:00:00Z", closedAt: null, grants: [] };
    const attempts = [0, 1].map((index) => ({ campaignId: campaign.id, runKey: `run-${index}`, lane: "certification", suite: "audit" as const, target: "local" as const, startedAt: "2026-09-05T10:00:00Z", completedAt: "2026-09-05T10:30:00Z" }));
    expect(campaignBudgetProblem({ campaign, attempts, suite: "audit", target: "local" })).toContain("2 audit/local complete attempts");
    expect(campaignBudgetProblem({ campaign, attempts, suite: "golden", target: "local" })).toBeNull();
    expect(campaignBudgetProblem({ campaign, attempts: [...attempts, ...attempts], suite: "golden", target: "local" })).toContain("120.0 total");
    expect(grantReferenceRunKey({ attempts, campaignId: campaign.id, suite: 'canary', target: 'cloud', lane: 'certification' })).toBe('run-1');
  });
  test("persists a campaign and consumes an extension exactly once for its source and boundary", () => {
    const directory = mkdtempSync(join(tmpdir(), "werkflow-campaign-"));
    const path = join(directory, "campaigns.json");
    try {
      const campaign = activeCampaign(path);
      expect(activeCampaign(path).id).toBe(campaign.id);
      const source = { campaignId: campaign.id, referenceRunKey: "failed-1", suite: "audit" as const, target: "local" as const, candidateFingerprint: "source-a", reason: "The retained trace and focused proof resolve the failure." };
      const id = issueRerunGrant(source, path);
      const validation = { campaign: readCampaigns(path)[0], grantId: id, suite: source.suite, target: source.target, candidateFingerprint: source.candidateFingerprint, latestRunKey: "failed-1" };
      expect(validatedRerunGrant(validation)?.id).toBe(id);
      expect(() => validatedRerunGrant({ ...validation, candidateFingerprint: "source-b" })).toThrow("stale");
      consumeRerunGrant(campaign.id, id, "retry-1", path);
      expect(() => validatedRerunGrant({ ...validation, campaign: readCampaigns(path)[0] })).toThrow("consumed");
      expect(() => consumeRerunGrant(campaign.id, id, "retry-2", path)).toThrow("already consumed");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
