const test = require('node:test');
const assert = require('node:assert/strict');
const inviteCache = require('../src/inviteCache');

function guild(id, snapshots) {
  let index = 0;
  return {
    id,
    invites: {
      fetch: async () => snapshots[Math.min(index++, snapshots.length - 1)],
    },
  };
}

function invites(...items) {
  return new Map(items.map((item) => [item.code, item]));
}

test('identifies a single invite whose use count increased', async () => {
  const target = guild('increase', [
    invites({ code: 'a', uses: 0 }),
    invites({ code: 'a', uses: 1 }),
  ]);
  await inviteCache.loadGuild(target);

  const result = await inviteCache.findUsedInvite(target);
  assert.equal(result.kind, 'single');
  assert.equal(result.invite.code, 'a');
});

test('identifies a one-time invite after Discord removes it', async () => {
  const target = guild('deleted', [
    invites({ code: 'one-time', uses: 0 }),
    invites(),
  ]);
  await inviteCache.loadGuild(target);
  inviteCache.noteDeletedInvite(target.id, 'one-time');

  const result = await inviteCache.findUsedInvite(target);
  assert.equal(result.kind, 'single');
  assert.equal(result.invite.code, 'one-time');
  assert.equal(result.invite.__gone, true);
});

test('does not attribute concurrent invite changes to the wrong user', async () => {
  const target = guild('ambiguous', [
    invites({ code: 'a', uses: 0 }, { code: 'b', uses: 0 }),
    invites({ code: 'a', uses: 1 }, { code: 'b', uses: 1 }),
  ]);
  await inviteCache.loadGuild(target);

  const result = await inviteCache.findUsedInvite(target);
  assert.deepEqual(result, { kind: 'ambiguous', candidateCount: 2 });
});

test('reports an unavailable result when Discord invite lookup fails', async () => {
  const target = {
    id: 'unavailable',
    invites: { fetch: async () => { throw new Error('missing permission'); } },
  };

  const result = await inviteCache.findUsedInvite(target);
  assert.deepEqual(result, { kind: 'unavailable' });
});
