const rank = require("./rank");

const commands = [rank];
const commandMap = new Map(commands.map((cmd) => [cmd.data.name, cmd]));

module.exports = { commands, commandMap };
