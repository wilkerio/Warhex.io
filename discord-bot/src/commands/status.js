const { EmbedBuilder } = require("discord.js");
const { config } = require("../config");

const data = {
  name: "status",
  description: "Mostra status do bot e opcionalmente do servidor do jogo",
  options: []
};

async function fetchGameStatus() {
  if (!config.gameStatusUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(config.gameStatusUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: false });
  try {
    const status = await fetchGameStatus().catch(() => null);
    const fields = [
      { name: "Bot", value: "Online", inline: true },
      { name: "Ping", value: `${Math.max(0, Math.round(interaction.client.ws.ping))}ms`, inline: true }
    ];

    if (status) {
      if (status.onlinePlayers != null) fields.push({ name: "Players Online", value: String(status.onlinePlayers), inline: true });
      if (status.region) fields.push({ name: "Region", value: String(status.region), inline: true });
      if (status.version) fields.push({ name: "Version", value: String(status.version), inline: true });
      if (status.uptime) fields.push({ name: "Server Uptime", value: String(status.uptime), inline: true });
    } else if (config.gameStatusUrl) {
      fields.push({ name: "Game Server", value: "Nao foi possivel consultar agora", inline: false });
    }

    const embed = new EmbedBuilder()
      .setTitle(`${config.brandName} • Status`)
      .setColor(0x38bdf8)
      .addFields(fields)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("/status error:", error);
    await interaction.editReply("Erro ao consultar status.");
  }
}

module.exports = { data, execute };
