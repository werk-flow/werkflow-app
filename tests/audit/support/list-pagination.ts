import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Database } from "../../../lib/supabase/database.types";
import { requireEnv } from "../../golden/support/env";
import { testSupabaseClientOptions } from "../../golden/support/client-options";
import type { TestWorld } from "../../golden/support/world";

const PAGE_FIXTURE_COUNT = 61;

function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), testSupabaseClientOptions);
}

/** Master data only; no stock is invented outside the inventory movement ledger. */
export async function seedInventoryPages(world: TestWorld): Promise<{ prefix: string; tailName: string }> {
  const prefix = `Seitenartikel ${world.runId.slice(0, 8)}`;
  const rows = Array.from({ length: PAGE_FIXTURE_COUNT }, (_, index) => ({
    organization_id: world.orgId, created_by: world.users.admin.id,
    name: `${prefix} ${String(index + 1).padStart(3, "0")}`,
    item_type: index === PAGE_FIXTURE_COUNT - 1 ? "tool" as const : "material" as const,
    unit: "piece" as const,
  }));
  const { error } = await adminClient().from("inventory_items").insert(rows);
  if (error) throw new Error(`Pagination inventory fixture failed: ${error.message}`);
  const tailRow = rows[PAGE_FIXTURE_COUNT - 1];
  if (!tailRow) throw new Error("Pagination inventory fixture has no tail row.");
  return { prefix, tailName: tailRow.name };
}

export async function persistedInventoryItem(world: TestWorld, name: string): Promise<{ id: string; name: string; item_type: string } | null> {
  const { data, error } = await adminClient().from("inventory_items").select("id,name,item_type")
    .eq("organization_id", world.orgId).eq("name", name).maybeSingle();
  if (error) throw new Error(`Pagination inventory observation failed: ${error.message}`);
  return data;
}

export function inventoryItemRow(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
}

export async function renameInventoryItem(page: Page, oldName: string, newName: string): Promise<void> {
  await inventoryItemRow(page, oldName).getByRole("button", { name: "Aktionen", exact: true }).click();
  await page.getByRole("menuitem", { name: "Bearbeiten", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Artikel bearbeiten", exact: true }) });
  await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeEnabled();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(newName);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Der Artikel wurde gespeichert.", { exact: true })).toBeVisible();
}

export type DocumentPageFixture = { tailName: string; tailJobTitle: string; tailJobNumber: string; tailDocumentId: string; tailJobId: string; otherJobId: string };

/** Metadata-only document fixtures. No upload/download is claimed or attempted. */
export async function seedDocumentPages(world: TestWorld): Promise<DocumentPageFixture> {
  const admin = adminClient();
  const jobs = Array.from({ length: PAGE_FIXTURE_COUNT }, (_, index) => ({
    id: crypto.randomUUID(), organization_id: world.orgId, created_by: world.users.admin.id,
    title: `Seitenauftrag ${String(index + 1).padStart(3, "0")}`,
    job_number: `PAGE-${world.runId.slice(0, 8)}-${String(index + 1).padStart(3, "0")}`,
  }));
  const { error: jobsError } = await admin.from("jobs").insert(jobs);
  if (jobsError) throw new Error(`Pagination job fixture failed: ${jobsError.message}`);
  const documents = jobs.map((_job, index) => {
    const id = crypto.randomUUID();
    return {
      id, organization_id: world.orgId, uploaded_by: world.users.admin.id,
      storage_path: `${world.orgId}/pagination/${id}/metadata.bin`, original_file_name: "metadata.bin",
      display_name: `Seitendatei ${String(index + 1).padStart(3, "0")}`,
      mime_type: "application/octet-stream", size_bytes: 1,
      category: index === PAGE_FIXTURE_COUNT - 1 ? "report" as const : "other" as const,
    };
  });
  const { error: documentsError } = await admin.from("documents").insert(documents);
  if (documentsError) throw new Error(`Pagination document fixture failed: ${documentsError.message}`);
  const { error: linksError } = await admin.from("document_links").insert(jobs.map((job, index) => {
    const document = documents[index];
    if (!document) throw new Error(`Pagination document fixture has no document for job ${index + 1}.`);
    return { organization_id: world.orgId, document_id: document.id, job_id: job.id, created_by: world.users.admin.id };
  }));
  if (linksError) throw new Error(`Pagination document link fixture failed: ${linksError.message}`);
  const tailDocument = documents[PAGE_FIXTURE_COUNT - 1];
  const tailJob = jobs[PAGE_FIXTURE_COUNT - 1];
  const [firstJob] = jobs;
  if (!tailDocument || !tailJob || !firstJob) throw new Error("Pagination document fixture is missing its tail rows.");
  return { tailName: tailDocument.display_name, tailJobTitle: tailJob.title, tailJobNumber: tailJob.job_number,
    tailDocumentId: tailDocument.id, tailJobId: tailJob.id, otherJobId: firstJob.id };
}

/** Exercise the real PostgREST view relationship used by getAttachableDocuments. */
export async function assertDocumentAttachableExclusion(world: TestWorld, fixture: DocumentPageFixture): Promise<void> {
  const admin = adminClient();
  const query = (organizationId: string, jobId: string) => admin.from("ordinary_documents")
    .select("id, existing:document_links()")
    .eq("organization_id", organizationId).eq("id", fixture.tailDocumentId)
    .eq("existing.organization_id", organizationId).eq("existing.job_id", jobId).is("existing", null);
  const [alreadyLinked, otherTarget, foreignOrganization] = await Promise.all([
    query(world.orgId, fixture.tailJobId), query(world.orgId, fixture.otherJobId), query(world.outsider.orgId, fixture.otherJobId),
  ]);
  for (const result of [alreadyLinked, otherTarget, foreignOrganization]) expect(result.error).toBeNull();
  expect(alreadyLinked.data).toEqual([]);
  expect(otherTarget.data).toEqual([{ id: fixture.tailDocumentId }]);
  expect(foreignOrganization.data).toEqual([]);
}

export function documentWorkRow(page: Page, jobTitle: string): Locator {
  return page.getByRole("main").getByRole("row").filter({ has: page.getByText(jobTitle, { exact: true }) });
}
