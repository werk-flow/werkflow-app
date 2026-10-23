// The actual avatar action over the in-memory database: a storage path of
// another user, as the new avatar or as the previous one to delete, is
// refused before the profile is written or a storage object is removed.
import assert from 'node:assert/strict';
import { CALLER_ID, installActionWorld, signInAs } from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const otherUserId = '8d000000-0000-4000-8000-000000000001';
const world = installActionWorld({
  profiles: [
    { id: CALLER_ID, avatar_path: `${CALLER_ID}/alt.png` },
    { id: otherUserId, avatar_path: `${otherUserId}/avatar.png` },
  ],
});
const { updateProfileAvatar } = await import('@/lib/settings/actions');

const initialDatabase = databaseSnapshot(world);
const refused = { success: false, error: 'not_authorized' };

// A signed-out caller changes no avatar.
world.callerId = null;
assert.deepEqual(await updateProfileAvatar({ avatarPath: `${CALLER_ID}/neu.png` }), {
  success: false,
  error: 'not_authenticated',
});

signInAs(world, 'employee');
// Another user's object is neither the caller's new avatar nor a previous avatar the caller may delete.
assert.deepEqual(await updateProfileAvatar({ avatarPath: `${otherUserId}/avatar.png` }), refused);
assert.deepEqual(
  await updateProfileAvatar({
    avatarPath: `${CALLER_ID}/neu.png`,
    previousAvatarPath: `${otherUserId}/avatar.png`,
  }),
  refused,
);
// A path that climbs out of the caller's folder is refused too.
assert.deepEqual(
  await updateProfileAvatar({ avatarPath: `${CALLER_ID}/../${otherUserId}/avatar.png` }),
  refused,
);
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
