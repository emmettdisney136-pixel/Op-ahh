"use strict";

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    id: { type: String, unique: true },

    blacklisted: { type: Boolean, default: false },
    staff: { type: Boolean, default: false },
    linked: { type: Boolean, default: false },

    skinOverwrites: { type: Object, default: {} },
    ownedCapes: { type: Array, default: [] },
    capeWhatsOn: { type: String, default: "" },
    linkData: { type: Object, default: {} },

    netherQuartz: { type: Number, default: 0 },
    sticky: {
        gamertag: { type: String, default: null },
        xuid: { type: String, default: null },
        playfabId: { type: String, default: null }
    }
});

const whitelistSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    name: { type: String, default: "" },
    ownerId: { type: String, default: "" }
})

const User = mongoose.model("User", userSchema)
const RealmWhitelist = mongoose.model("Whitelist", whitelistSchema)

mongoose.set('strictQuery', false)
mongoose.connect(require('../Config.json')?.MongoUri)
    .then(() => console.log('connected to mongodb'))
    .catch(err => { console.error('failed to connect to mongodb, exiting.', err); process.exit(1) });

function cacheFactory(user) {
    class Cache {
        async getCached() { return user.linkData; }

        async setCached(value) {
            user.linkData = value || {};

            await this.#save();
        }

        async setCachedPartial(value) {
            user.linkData = { ...user.linkData, ...value };

            await this.#save();
        }

        async #save() {
            try {
                await user.save();
            } catch {
                user = await User.findOne({ id: user.id });

                await user.save();
            }
        }
    }

    return () => new Cache();
}

module.exports = { User, RealmWhitelist, cacheFactory }
