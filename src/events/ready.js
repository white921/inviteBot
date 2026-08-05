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
    if (invite) {
      await invite.delete('Retiring pre-migration unlimited panel invite');
    }
    await db.markInviteRevoked(guild.id, code);
  }
  console.log(`[ready] Retired ${legacyCodes.length} legacy panel invites for guild ${guild.id}`);
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    const commands = client.commands.map((c) => c.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    for (const guild of client.guilds.cache.values()) {
      await inviteCache.loadGuild(guild);
      try {
        await revokeLegacyPanelInvites(guild);
      } catch (err) {
        console.error(`[ready] Failed to retire legacy invites for guild ${guild.id}:`, err.message);
      }
      try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
        console.log(`[ready] Registered ${commands.length} commands for guild ${guild.id}`);
      } catch (err) {
        console.error(`[ready] Failed to register commands for guild ${guild.id}:`, err.message);
      }
    }
  },
};
