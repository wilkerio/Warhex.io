const { EmbedBuilder } = require("discord.js");
const { fetchGlobalTop } = require("../supabase");
const { formatScore, formatPlaytime } = require("../utils/format");
const { config } = require("../config");

const data = {
  name: "rank",
  description: "Mostra o Top 10 global de contas",
  options: []
};

async function execute(interaction) {
  await interaction.deferReply();
  try {
    const top = await fetchGlobalTop(10);
    if (!top.length) {
      await interaction.editReply("Nenhum jogador encontrado no ranking global ainda.");
      return;
    }

    const lines = top.map((u, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
      return `${medal} **${u.displayName}** | Score: \`${formatScore(u.highscore)}\` | Play: \`${formatPlaytime(u.playtime)}\` | Kills: \`${u.kills}\``;
    });

    const embed = new EmbedBuilder()
      .setTitle(`${config.brandName} • Global Rank`)
      .setDescription(lines.join("\n"))
      .setColor(0x8b5cf6)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("/rank error:", error);
    await interaction.editReply("Erro ao buscar o ranking global.");
  }
}

module.exports = { data, execute };
