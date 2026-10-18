const { Client } = require('discord.js');

class ReadyEvent {
    name = "clientReady";
    once = true;

    /** @param {Client} client */
    async execute(client) {
        console.log(`Logged in as ${client.user.tag}`);

        await client._loader.loadCommands();

        console.log(`Startup took ${client.uptime}ms`);
    }
}

module.exports = ReadyEvent;