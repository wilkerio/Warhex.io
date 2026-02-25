const { REST, Routes } = require("discord.js");
const { config } = require("./config");
const { commands } = require("./commands");

async function main() {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const body = commands.map((c) => c.data);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    console.log(`Registered ${body.length} guild commands in ${config.guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(`Registered ${body.length} global commands`);
  }
}

main().catch((error) => {
  console.error("Failed to register commands:", error);
  process.exit(1);
});
