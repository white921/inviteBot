const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { INVITE_PANEL_CHANNEL_ID } = require('../constants');

const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('招待リンク発行パネルをこのチャンネルに設置します（管理者専用）')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

async function execute(interaction) {
  if (INVITE_PANEL_CHANNEL_ID && interaction.channelId !== INVITE_PANEL_CHANNEL_ID) {
    await interaction.reply({
      content: `<#${INVITE_PANEL_CHANNEL_ID}> でこのコマンドを実行してください。`,
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('📨 招待リンク発行パネル')
    .setDescription([
      'リンク発行ボタンを押すと、招待リンクを発行します。',
      '',
      '1人の招待につき1つのリンクが必要となるため、複数人を招待する際は、',
      'リンクを送信するたびに発行し直していただくようお願い申し上げます。',
    ].join('\n'))
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('issue_invite')
      .setLabel('🔗 招待リンクを発行')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: 'パネルを設置しました。', ephemeral: true });
}

module.exports = { data, execute };
