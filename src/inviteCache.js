const cache = new Map();

function snapshot(invites) {
  const map = new Map();
  for (const invite of invites.values()) {
    map.set(invite.code, {
      uses: invite.uses ?? 0,
      inviter: invite.inviter ?? null,
    });
  }
  return map;
}

async function loadGuild(guild) {
  try {
    const invites = await guild.invites.fetch();
    cache.set(guild.id, snapshot(invites));
    console.log(`[inviteCache] Cached ${invites.size} invites for guild ${guild.id}`);
  } catch (err) {
    console.error(`[inviteCache] Failed to fetch invites for guild ${guild.id}:`, err.message);
    cache.set(guild.id, new Map());
  }
}

function getCachedUses(guildId, code) {
  return cache.get(guildId)?.get(code)?.uses ?? 0;
}

function setCachedUses(guildId, code, uses) {
  let guildCache = cache.get(guildId);
  if (!guildCache) {
    guildCache = new Map();
    cache.set(guildId, guildCache);
  }
  guildCache.set(code, { uses, inviter: null });
}

function noteDeletedInvite() {
  // A one-time invite disappears as soon as it is used.  Keep its pre-delete
  // cache entry until the following guildMemberAdd comparison can identify it.
}

/**
 * Compare cached uses with current invites to find which invite was used.
 * Returns one candidate only when attribution is unambiguous. Discord does not
 * include an invite code in guildMemberAdd, so concurrent changes are logged as
 * unknown rather than being assigned to the wrong inviter.
 */
async function findUsedInvite(guild) {
  let current;
  try {
    current = await guild.invites.fetch();
  } catch (err) {
    console.error(`[inviteCache] Failed to refetch invites for guild ${guild.id}:`, err.message);
    return { kind: 'unavailable' };
  }

  const guildCache = cache.get(guild.id) ?? new Map();

  const candidates = new Map();

  // Case 1: an invite still exists and its uses increased.
  for (const invite of current.values()) {
    const prev = guildCache.get(invite.code)?.uses ?? 0;
    if ((invite.uses ?? 0) > prev) {
      candidates.set(invite.code, invite);
    }
  }

  // Case 2: an invite disappeared (normally a single-use invite was consumed).
  for (const [code, previous] of guildCache) {
    if (!current.has(code)) {
      candidates.set(code, {
        code,
        inviter: previous.inviter,
        uses: null,
        __gone: true,
      });
    }
  }

  // Replace cache with the fresh snapshot regardless.
  cache.set(guild.id, snapshot(current));

  if (candidates.size === 1) {
    return { kind: 'single', invite: candidates.values().next().value };
  }
  if (candidates.size > 1) {
    return { kind: 'ambiguous', candidateCount: candidates.size };
  }
  return { kind: 'none' };
}

module.exports = {
  loadGuild,
  getCachedUses,
  setCachedUses,
  noteDeletedInvite,
  findUsedInvite,
};
