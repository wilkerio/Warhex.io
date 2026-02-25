const { EmbedBuilder } = require("discord.js");
const { findProfileByQuery, fetchGlobalTop } = require("../supabase");
const { formatPlaytime, formatScore } = require("../utils/format");
const { config } = require("../config");

const data = {
  name: "profile",
  description: "Mostra stats de um jogador",
  options: [
    {
      type: 3,
      name: "player",
      description: "Nickname/username/email do jogador",
      required: true
    }
  ]
};

async function execute(interaction) {
  const query = interaction.options.getString("player", true);
  await interaction.deferReply();
  try {
    const user = await findProfileByQuery(query);
    if (!user) {
      await interaction.editReply(`Nao encontrei perfil para: \`${query}\``);
      return;
    }

    let rankText = "N/A";
    try {
      const top = await fetchGlobalTop(200);
      const index = top.findIndex((p) => String(p.displayName).toLowerCase() === String(user.displayName).toLowerCase());
      if (index >= 0) rankText = `#${index + 1}`;
    } catch {}

    const embed = new EmbedBuilder()
      .setTitle(`${config.brandName} • Profile`)
      .setColor(0x22c55e)
      .addFields(
        { name: "Nome", value: `**${user.displayName}**`, inline: false },
        { name: "Highscore", value: formatScore(user.highscore), inline: true },
        { name: "Playtime", value: formatPlaytime(user.playtime), inline: true },
        { name: "Kills", value: String(user.kills), inline: true },
        { name: "XP", value: String(user.xp || 0), inline: true },
        { name: "Level", value: String(user.level || 0), inline: true },
        { name: "Rank", value: rankText, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("/profile error:", error);
    await interaction.editReply("Erro ao buscar perfil.");
  }
}

module.exports = { data, execute };
