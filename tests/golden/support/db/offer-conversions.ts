import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { seedDecidedOffer } from './offer-decisions';
import { createAdminClient } from './shared';
import { seedJobAssignment } from './work';
import type { TestWorld } from '../world';

// A made-up accepted offer converted into a new job through the real
// function, convert_offer_to_work (werk-flow/werkflow-planning#388), with the
// world's employee assigned to that job, so the office reads its priced
// Auftragsumfang and the field worker its scope.

const convertedSchema = z.object({ workId: z.string() });

/** Seeds an offer titled `<title> <runId>`, accepted and converted into a new job; answers the offer's id. */
export async function seedConvertedOffer(world: TestWorld, title: string): Promise<string> {
  const offerId = await seedDecidedOffer(world, title, 'angenommen');
  const { data } = await createAdminClient()
    .rpc('convert_offer_to_work', {
      p_actor_id: world.users.buero.id,
      p_organization_id: world.orgId,
      p_offer_id: offerId,
      p_expected_version: 3,
      p_attempt_key: randomUUID(),
      p_target: 'job',
      p_title: `${title} ${world.runId}`,
    })
    .throwOnError();
  await seedJobAssignment({
    orgId: world.orgId,
    actorId: world.users.buero.id,
    jobId: convertedSchema.parse(data).workId,
    userId: world.users.employee.id,
  });
  return offerId;
}

/** The number of the job the offer became. */
export async function convertedJobNumber(world: TestWorld, offerId: string): Promise<string> {
  const { data } = await createAdminClient()
    .rpc('get_offer_order', { p_organization_id: world.orgId, p_offer_id: offerId })
    .throwOnError();
  return z.object({ number: z.string() }).parse(data).number;
}
