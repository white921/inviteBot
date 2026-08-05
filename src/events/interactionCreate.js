const { Events } = require('discord.js');
const db = require('../db');
const inviteCache = require('../inviteCache');
const { INVITE_PANEL_CHANNEL_ID } = require('../constants');

const issueQueues = new Map();

function enqueueIssue(guildId, userId, task) {
  const key = `${guildId}:${userId}`;
  const previous = issueQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  issueQueues.set(key, current);
  return current.finally(() => {
    if (issueQueues.get(key) === current) issueQueues.delete(key);
  });
}

async function handleIssueInvite(interaction) {
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const targetChannel = INVITE_PANEL_CHANNEL_ID
    ? await guild.channels.fetch(INVITE_PANEL_CHANNEL_ID).catch(() => null)
    : interaction.channel;

  if (!targetChannel || !targetChannel.isTextBased()) {
    await interaction.editReply('招待リンク発行チャンネルが見つかりません。設定を確認してください。');
    return;
  }

  // Check for existing owner invite
  const existingCode = await db.getActiveOwnerInvite(guild.id, userId);
  if (existingCode) {
    try {
      const invites = await guild.invites.fetch();
      if (invites.has(existingCode)) {
        await interaction.editReply(
          `あなたの招待リンク: https://discord.gg/${existingCode}`
        );
        return;
      }
    } catch (err) {
      console.error('[interactionCreate] Failed to fetch existing invites:', err.message);
      await interaction.editReply('既存の招待リンクを確認できませんでした。しばらくしてから再度お試しください。');
      return;
    }
    // The recorded invite no longer exists — retire its DB record before issuing
    // a replacement, so one owner never has two active panel links.
    await db.markActiveInviteRevoked(guild.id, existingCode);
  }

  let invite;
  try {
    invite = await targetChannel.createInvite({
      maxAge: 0,
      maxUses: 1,
      unique: true,
      reason: `Issued via panel for user ${interaction.user.tag} (${userId})`,
    });
  } catch (err) {
    console.error('[interactionCreate] createInvite failed:', err);
    await interaction.editReply('招待リンクの発行に失敗しました。Bot の権限を確認してください。');
    return;
  }

  await db.saveInviteOwner(guild.id, invite.code, userId);
  inviteCache.setCachedUses(guild.id, invite.code, invite.uses ?? 0);

  await interaction.editReply(`あなたの招待リンク: https://discord.gg/${invite.code}`);
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
      if (interaction.customId === 'issue_invite') {
          await interaction.deferReply({ ephemeral: true });
          await enqueueIssue(interaction.guildId, interaction.user.id, () => handleIssueInvite(interaction));
        }
      }
    } catch (err) {
      console.error('[interactionCreate] handler error:', err);
      const msg = 'エラーが発生しました。しばらくしてから再度お試しください。';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  },
};
