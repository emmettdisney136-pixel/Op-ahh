const fs = require("fs");
const { REST, Routes } = require("discord.js");

class Loader {
    constructor(client, log = () => {}) {
        this.client = client;

        this.log = log;
    }

    #getFiles(base, ignore = []) {
        // For me, vision;
        if (base.includes("/workspaces/Perxa-/Classes/DiscordJS/../../Commands")) base = "/workspaces/Perxa-/Commands";

        return fs.readdirSync(base)
            .filter(folder => !ignore.includes(folder))
            .flatMap(folder =>
                fs.readdirSync(`${base}/${folder}`)
                    .filter(file => file.endsWith(".js"))
                    .map(file => `${base}/${folder}/${file}`)
            );
    }

    async loadCommands() {
        const rest = new REST({ version: "10" }).setToken(this.client?.token);
        const grouped = new Map();

        for (const file of this.#getFiles(`${__dirname}/../../Commands`, ["_"])) {
            const Command = require(file);

            if (!Command || typeof Command !== 'function' || !/^class\s/.test(Function.prototype.toString.call(Command))) continue;

            const command = new Command();

            command.data ??= {
                name: String(Math.random()).slice(2),
                description: "Not set."
            };

            command.execute ??= interaction => 
                interaction.reply?.("### -# **This command hasn't been implemented yet.**");

            this.client.commands.set(command.subCommand ? `${command.subCommand} ${command.data.name}` : command.data.name, command);

            if (!command.subCommand) {
                this.log(`[debug] Loaded command: ${command.data.name}`);
                continue;
            }

            const group =
                grouped.get(command.subCommand) ??
                grouped
                    .set(command.subCommand, {
                        name: command.subCommand,
                        description: `${command.subCommand} commands`,
                        global: command.global,
                        options: []
                    })
                    .get(command.subCommand);

            group.global ||= command.global;
            group.options.push({ type: 1, ...command.data });

            this.log(`[debug] Loaded subCommand: ${command.subCommand + command.data.name}`);
        }

        const body = [
            ...[...this.client.commands.values()]
                .filter(command => !command.subCommand)
                .map(command => ({
                    ...command.data,
                    type: 1,
                    contexts: command.global ? [0, 1, 2] : [0],
                    dm_permission: true
                })),

            ...[...grouped.values()].map(group => ({
                ...group,
                type: 1,
                contexts: group.global ? [0, 1, 2] : [0],
                dm_permission: true
            }))
        ];

        await rest.put(Routes.applicationCommands(this.client.user?.id), { body });
    }

    loadEvents() {
        for (const file of this.#getFiles(`${__dirname}/../../Events`)) {
            const Event = require(file);
            const event = new Event();

            this.client.events.set(event.name, event);
            this.client[event.once ? "once" : "on"](event.name, (...args) => event.execute(...args, this.client));

            this.log(`[debug] Loaded event: ${event.name}`);
        }
    }
}

module.exports = Loader;