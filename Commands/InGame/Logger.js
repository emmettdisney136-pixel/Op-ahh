const Command = require("../_/Command.js");

const RealmApi = require('../../Classes/Realm.js')
const Client = require('../../Classes/Client.js');

class Logger extends Command {
    linkOnly = true;

    constructor() {
        super("logger", "Listen's to packets for positions, vary of methods (TY tsl).", require('../../Data/InputBlock.json'));
    }

    /**
     * @param {import("discord.js").CommandInteraction} interaction
     * @param {{ components: import("../../Classes/DiscordJS/Component.js") }} helpers
     */
    async execute(interaction, { components, args }) {
        const { input } = args;
        Object.assign(this, { interaction, components });

        await interaction.deferReply({ flags: this.flags });

        if (this.maps.inGame.has(interaction.user.id) && !this.maps.inGame.has(interaction.user.id)?.disconnect)
            return this.fastReply("Already in game.", "You are already doing a in-game command, please wait for it to finish before doing another one.");
        this.maps.inGame.set(interaction.user.id, { type: "seedRealm", input, stage: "testingRealm", client: null, disconnect: false });

        try {
            const realmApi = new RealmApi(interaction.dbUser, true);
            await realmApi.init();

            let realm = /^\d+$/.test(input)
                ? await realmApi.getRealmInfoByID(input, true)
                : await realmApi.getRealmInfo(input, false, true);

            if (realm?.errorMsg) return this.invalidApiResponse(realm, input);

            let host = await realmApi.getRealmIP(realm?.id, true);
            if (host?.errorMsg) return this.invalidApiResponse(host, input);
            realm.address = host.address;

            let logs = [];
            const client = new Client(realmApi, realm, interaction.dbUser);
            if (this.maps.inGame.get(interaction.user.id).disconnect)
                client.destroyClient('User requested close before client connection.', 'fastClose');

            this.maps.inGame.get(interaction.user.id).client = client;

            client.timeouts.push(setTimeout(() => {
                client.destroyClient("Client timeout, Client -> Server closed.", "connectionVoided")
                this.maps.inGame.delete(interaction.user.id)
            },
                5 * 60000)); // 5 minutes timeout!

            client.on('start_game', async () => {
                components
                    .reset()
                    .separator()
                    .text(
                        `### Realm Logger.\n` +
                        `-# perxa has connected to **${realm.name}** *(${realm.id})*, and has started to listen in on packet's what expose positions.` +
                        ` The bot listens for attacking, potions, beds, death positions, containers, and any more if they are available.` +
                        ` The bot will disconnect **<t:${Math.floor(Date.now() / 1000) + 5 * 60}:R>**.\n\n` +
                        `-# **Logs will be displayed after the bot disconnects, you can run  \` / cancel \`  at any time.**`
                    )
                    .separator();

                await interaction.editReply({ components, flags: this.flags });
            });

            client.on('level_event', ({ event, position: { x, y, z }, data }) => {
                switch (event) { // those 2 are global and there could be more but im not gonna test them all
                    case 'add_particle_smash_attack_ground_dust':
                        logs.push({ type: 'particle', message: `Mace particle at ${x}, ${y}, ${z}` })
                        break
                    case 'particle_splash':
                        logs.push({ type: 'particle', message: `Potion splash at ${x}, ${y}, ${z} (${data})` })
                        break
                    default:
                        return
                }
            })

            client.on('add_player', ({ metadata, username }) => {
                const { x: lastDeathX, y: lastDeathY, z: lastDeathZ } = metadata.find(m => m.key === "player_last_death_position")?.value;
                const { x: bedX, y: bedY, z: bedZ } = metadata.find(m => m.key === "bed_enter_position")?.value;

                if (lastDeathX != 0 && lastDeathY != 0 && lastDeathZ != 0)
                    logs.push({ type: 'player', message: `${username} last died position: ${lastDeathX}, ${lastDeathY}, ${lastDeathZ}` });

                if (bedX != 0 && bedY != 0 && bedZ != 0)
                    logs.push({ type: 'player', message: `${username} bed position: ${bedX}, ${bedY}, ${bedZ}` });
            })

            client.on('move_player', ({ position: { x, y, z }, mode, teleport }) => {
                if (mode != "teleport") return

                logs.push({ type: 'player', message: `Player Teleported to ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}. Cause: ${teleport.cause}` })
            })

            client.on('block_event', ({ position: { x, y, z }, type, data }) => {
                if (type !== 'change_state') return // there is sound for note blocks but why would we ever need to log that bs

                switch (data) {
                    case 0:
                        logs.push({ type: 'block', message: `Container opened at ${x}, ${y}, ${z}` })
                        break
                    case 1:
                        logs.push({ type: 'block', message: `Container closed at ${x}, ${y}, ${z}` })
                        break
                    default: // for note blocks there are more data values but ig there is only 0-1 for chest stuff
                        logs.push({ type: 'block', message: `Container action at ${x}, ${y}, ${z}` })
                }
            })

            client.on('block_entity_data', ({ nbt, position: { x, y, z } }) => {
                switch (nbt.value?.id.value) {
                    case 'ShulkerBox':
                        const list = nbt.value.Items?.value?.value.map((
                            { Name, Count }) =>
                            `${Name.value.replace('minecraft:', '')} x${Count.value}`
                        ).join(', ');

                        logs.push({ type: 'block', message: `A ShulkerBox was placed at: ${x}, ${y}, ${z}. Items: ${list || 'empty ShulkerBox bruh'}` })
                        break
                    case 'Sign': // tbh could add sign text owner with xuid but to lazzy to add that
                        logs.push({ type: 'block', message: `Sign @ ${x}, ${y}, ${z} — "${nbt.value.FrontText.value.Text.value || 'Empty'}" / "${nbt.value.BackText.value.Text.value || 'Empty'}"` })
                        break
                    case 'Beacon':
                        logs.push({ type: 'block', message: `A Beacon was placed at: ${x}, ${y}, ${z}.` }) // could add levels but seems useless
                        break
                    default:
                        logs.push({ type: 'block', message: `A Entity Block was placed or destroyed at: ${x}, ${y}, ${z}.` })
                }
            })

            client.once('clientClosed', async ({ reason }) => {
                this.maps.inGame.delete(this.interaction.user.id);
                
                logs = [...new Map(logs.map(log => [`${log.type}:${log.message}`, log])).values()];

                components
                    .reset()
                    .separator()
                    .text(
                        `### Client Disconnected.\n` +
                        `-# perxa has disconnected from **${realm.name}** *(${realm.id})*, you can read below to see the logs, some information maybe wrong due to the time logged to now.` +
                        `\n### Reason\n### -# > ${reason}`
                    )
                    .separator()
                    .addFile(`attachment://perxa-${realm.name}-${realm.id}.txt`)

                await interaction.editReply({
                    components, flags: this.flags, files: [
                        {
                            name: `perxa-${realm.name}-${realm.id}.txt`,
                            attachment: Buffer.from(logs.length ? logs.map(log => `${log.type} - ${log.message}`).join('\n') : 'No logs to display.', 'utf-8'),
                        }
                    ]
                });
            });
        } catch (error) {
            console.error(error);
        }
    }
}

module.exports = Logger;