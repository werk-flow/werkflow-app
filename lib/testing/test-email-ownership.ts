type EmailOwner = { runId: string; additionalUserEmails?: readonly string[] };

/** Validate archived ownership before an exact-email database lookup can authorize cleanup. */
export function ownedTestEmails(owner: EmailOwner): string[] {
  if (!/^[a-z0-9]+$/.test(owner.runId)) throw new Error('Invalid test world identity for email ownership.');
  const suffix = `-${owner.runId}@werkflow-golden.test`;
  const emails = owner.additionalUserEmails ?? [];
  if (!Array.isArray(emails) || emails.some((email) =>
    typeof email !== 'string' || !email.endsWith(suffix) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(email.slice(0, -suffix.length)) ||
    email.split('@')[0]!.length > 64
  )) throw new Error('A registered test email does not belong to its world. Refusing cleanup.');
  return [...new Set(emails)];
}

export function addOwnedTestEmail<World extends EmailOwner>(input: {
  world: World;
  requestedRunId: string;
  label: string;
}): { world: World & { additionalUserEmails: string[] }; email: string } {
  if (input.world.runId !== input.requestedRunId) throw new Error('The email mint targets another test world.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.label)) throw new Error('Invalid test email label.');
  const email = `${input.label}-${input.requestedRunId}@werkflow-golden.test`;
  const world = { ...input.world, additionalUserEmails: [...ownedTestEmails(input.world), email] };
  world.additionalUserEmails = ownedTestEmails(world);
  return { world, email };
}

/** A fixture loaded before signup must not erase the subsequently recorded cleanup ownership. */
export function preserveOwnedTestEmails<World extends EmailOwner>(next: World, previous?: EmailOwner): World & { additionalUserEmails: string[] } {
  if (previous && previous.runId !== next.runId) throw new Error('Cannot replace a different owned world without retiring its state.');
  return {
    ...next,
    additionalUserEmails: [...new Set([...ownedTestEmails(next), ...(previous ? ownedTestEmails(previous) : [])])],
  };
}
