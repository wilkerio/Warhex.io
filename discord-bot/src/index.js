const { Client, GatewayIntentBits, Events } = require("discord.js");
const { config } = require("./config");
const { commandMap } = require("./commands");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[Discord Bot] Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commandMap.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: "Comando nao encontrado.", ephemeral: true }).catch(() => {});
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Erro ao executar o comando.").catch(() => {});
    } else {
      await interaction.reply({ content: "Erro ao executar o comando.", ephemeral: true }).catch(() => {});
    }
  }
});

client.login(config.discordToken).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
