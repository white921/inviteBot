const { Events } = require('discord.js');
const inviteCache = require('../inviteCache');
const db = require('../db');
const { notifyMemberJoin } = require('../notifier');

const guildQueues = new Map();

function enqueueGuildMemberAdd(guildId, task) {
  const previous = guildQueues.get(guildId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  guildQueues.set(guildId, current);
  return current.finally(() => {
    if (guildQueues.get(guildId) === current) guildQueues.delete(guildId);
  });
}

async function processMemberAdd(member) {
  if (member.user.bot) return;

  const guild = member.guild;
  const result = await inviteCache.findUsedInvite(guild);

  let inviterId = null;
  let inviteCode = null;
  let attributionStatus = 'unknown';
  let attributionReason = result.kind;
  let totalCount = 0;
  let isRecorded = false;

  if (result.kind === 'single') {
    inviteCode = result.invite.code;
    // Only a currently active, panel-issued one-time link is eligible for
    // attribution. Manual or pre-migration links are recorded as unknown.
    const confirmation = await db.consumeAndRecordInvite(guild.id, inviteCode, member.id);
    if (confirmation) {
      inviterId = confirmation.ownerId;
      totalCount = confirmation.totalCount;
      isRecorded = true;
      attributionStatus = 'confirmed';
      attributionReason = 'panel_single_use';
    } else {
      attributionReason = 'unmanaged_or_inactive_invite';
    }
  } else if (result.kind === 'ambiguous') {
    attributionReason = `ambiguous_${result.candidateCount}_invite_changes`;
  }

  let inviter = null;

  if (inviterId) {
    inviter = await member.client.users.fetch(inviterId).catch(() => null);
  }

  if (!isRecorded) {
    await db.logInvite({
      guildId: guild.id,
      inviterId,
      inviteeId: member.id,
      inviteCode,
      attributionStatus,
      attributionReason,
    });
  }

  await notifyMemberJoin(member.client, {
    guild,
    member,
    inviter,
    totalCount,
  });
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    return enqueueGuildMemberAdd(member.guild.id, () => processMemberAdd(member));
  },
};
