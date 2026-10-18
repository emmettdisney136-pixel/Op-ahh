const ComponentBuilder = require("../../Classes/DiscordJS/Component");
const { User } = require("../../Data/JS/Database");

class InteractionEvent {
    name = "interactionCreate";
    once = false;

    #cooldowns = new Map();

    /** @param {import("discord.js").Interaction} interaction */
    async execute(interaction) {
        try {
            if (interaction.isChatInputCommand()) {
                await this.#handleCommand(interaction);
                return;
            }

            if (interaction.isButton()) {
                await this.#handleButton(interaction);
                return;
            }
        } catch (error) {
            await this.#handleError(interaction, error);
        }
    }

    async #handleCommand(interaction) {
        if (typeof User.findOne !== "function") return;

        const command = this.#getCommand(interaction);
        if (!command) return;

        console.log(
            `[interaction] ${interaction.user.tag} (${interaction.user.id}) executed ` +
            `${command?.subCommand ? `${command?.subCommand} ${command?.data.name}` : interaction.commandName} ` +
            `InGuild: ${interaction.guild?.id ? true : false}`
        );

        if (await this.#handleCooldown(interaction, command)) return;

        const dbUser = (await User.findOne({ id: interaction.user.id })) ?? new User({ id: interaction.user.id });
        await dbUser.save();

        if (await this.#runChecks(interaction, command, dbUser)) return;

        const components = new ComponentBuilder();

        const args = {};
        for (const option of interaction.options._hoistedOptions ?? []) args[option.name] = option.value;

        interaction.dbUser = dbUser;

        await command.execute(interaction, { components, args });

        console.log(
            `[interaction] ${interaction.user.tag} (${interaction.user.id}) executed ` +
            `${command?.subCommand ? `${command?.subCommand} ${command?.data.name}` : interaction.commandName} ` +
            `finished in ${Date.now() - interaction.createdTimestamp}ms ` +
            `InGuild: ${interaction.guild?.id ? true : false}`
        );
    }

    async #handleButton(interaction) {
        const [commandName] = interaction.customId.split(":");

        const command = interaction.client.commands.get(commandName);
        if (!command || typeof command.button !== "function") return;

        console.log(
            `[button] ${interaction.user.tag} (${interaction.user.id}) ` +
            `clicked ${interaction.customId} ` +
            `InGuild: ${interaction.guild?.id ? true : false}`
        );

        // if (await this.#handleCooldown(interaction, command)) return;
        if (typeof User.findOne !== "function") return;

        const dbUser = (await User.findOne({ id: interaction.user.id })) ?? new User({ id: interaction.user.id });
        await dbUser.save();

        if (await this.#runChecks(interaction, command, dbUser)) return;

        const components = new ComponentBuilder();
        interaction.dbUser = dbUser;

        /*
         * customId = "account:view"
         * customId = "account:view:12345"
         */
        const parts = interaction.customId.split(":");

        const action = parts[1];
        const args = parts.slice(2);

        await command.button(interaction, { action, args, components });

        console.log(
            `[button] ${interaction.user.tag} (${interaction.user.id}) ` +
            `clicked ${interaction.customId} ` +
            `finished in ${Date.now() - interaction.createdTimestamp}ms ` +
            `InGuild: ${interaction.guild?.id ? true : false}`
        );
    }

    #getCommand(interaction) {
        const option = interaction.options?.data?.[0];

        return interaction.client.commands.get(
            option?.type === 1
                ? `${interaction.commandName} ${option.name}`
                : interaction.commandName
        );
    }

    async #handleCooldown(interaction, command) {
        const now = Date.now();
        const cooldown = this.#cooldowns.get(interaction.user.id);

        if (cooldown && now < cooldown.time) {
            const payload = {
                content: 
                    `### -# *You're on a cooldown from **${cooldown.command}**, ` +
                    `resets <t:${Math.floor(cooldown.time / 1000)}:R>*`,
                flags: 64
            };

            interaction.replied || interaction.deferred
                ? await interaction.followUp(payload)
                : await interaction.reply(payload);

            return true;
        }

        this.#cooldowns.set(interaction.user.id, {
            command:
                command.data?.name ??
                interaction.commandName ??
                interaction.customId,
            time: now + command.cooldown
        });

        return false;
    }

    async #runChecks(interaction, command, dbUser) {
        const checks = [
            [
                command.staffOnly && !dbUser?.staff,
                "### -# **This command is staff only, please contact a staff member if you believe this is an error.**"
            ],
            [
                command.linkOnly && !dbUser?.linked,
                "### -# *This command requires you to opt in, please run `/account link` to link to perxa.*"
            ]
        ];

        for (const [failed, content] of checks) {
            if (!failed) continue;

            const payload = { content, flags: 64 };

            interaction.replied || interaction.deferred
                ? await interaction.followUp(payload)
                : await interaction.reply(payload);

            return true;
        }

        return false;
    }

    async #handleError(interaction, error) {
        console.error(`[interaction] error while handling ${interaction.type}:`, error);

        const payload = {
            content: "### -# **An error occurred while executing this interaction.**",
            flags: 64,
            files: [
                {
                    name: "error.txt",
                    attachment: Buffer.from(error?.stack ?? error?.message, "utf8")
                }
            ]
        };

        try {
            return interaction.replied || interaction.deferred
                ? await interaction.followUp(payload)
                : await interaction.reply(payload);
        } catch (replyError) { /* tbf ts annoying */ }
    }
}

module.exports = InteractionEvent;