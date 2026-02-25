const rank = require("./rank");
const profile = require("./profile");
const status = require("./status");

const commands = [rank, profile, status];
const commandMap = new Map(commands.map((cmd) => [cmd.data.name, cmd]));

module.exports = { commands, commandMap };
