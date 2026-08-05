const { Events, REST, Routes } = require('discord.js');
const inviteCache = require('../inviteCache');
const db = require('../db');
const { DISCORD_TOKEN } = require('../config');

async function revokeLegacyPanelInvites(guild) {
  const legacyCodes = await db.getLegacyInviteCodes(guild.id);
  if (legacyCodes.length === 0) return;

  const invites = await guild.invites.fetch();
  for (const code of legacyCodes) {
    const invite = invites.get(code);
    if (invite) await invite.delete('Retiring pre-migration unlimited panel invite');
    await db.markInviteRevoked(guild.id, code);
  }
}

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    await inviteCache.loadGuild(guild);
    try {
      await revokeLegacyPanelInvites(guild);
    } catch (err) {
      console.error(`[guildCreate] Failed to retire legacy invites for guild ${guild.id}:`, err.message);
    }

    const commands = guild.client.commands.map((c) => c.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    try {
      await rest.put(Routes.applicationGuildCommands(guild.client.user.id, guild.id), { body: commands });
      console.log(`[guildCreate] Registered ${commands.length} commands for guild ${guild.id}`);
    } catch (err) {
      console.error(`[guildCreate] Failed to register commands for guild ${guild.id}:`, err.message);
    }
  },
};
