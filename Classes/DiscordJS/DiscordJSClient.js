const { Client, GatewayIntentBits } = require('discord.js');

const Loader = require('./Loaders');
const Config = require('../../Data/Config.json');

class DiscordJSClient extends Client {
    constructor() {
        super({
            intents: Object.values(GatewayIntentBits),
            sweepers: { messages: { interval: 300, lifetime: 600 } },
            rest: {
                retries: 2,
                timeout: 15000,
                rejectOnRateLimit: false,
            },
            ws: {
                large_threshold: 50,
                compress: false,
                properties: {
                    os: process.platform,
                    browser: 'discord.js',
                    device: 'discord.js',
                },
            },
            presence: {
                status: 'dnd',
                activities: [
                    {
                        name: '/nethernet',
                        type: 0,
                    },
                ],
            },
            allowedMentions: {
                parse: [],
                repliedUser: false,
            },
            failIfNotExists: false,
            enforceNonce: true
        });

        this.events = new Map();
        this.commands = new Map();

        this._loader = new Loader(this, Config.Debug ? console.log : null);
        this._token = Config.UseBetaToken ? Config.BetaToken : Config.Token;
    }

    start() {
        this._loader.loadEvents();

        return this.login(this._token);
    }
}

module.exports = DiscordJSClient;