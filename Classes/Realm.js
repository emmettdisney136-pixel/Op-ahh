const XboxAPI = require("./Xbox");

const { RealmWhitelist } = require('../Data/JS/Database')

const AndroidDevice = require("../Data/JS/Devices").android
const httpsSTATUS = require('../Data/minecraft/httpsStatus.json');
const getRealmIPBody = require("../Data/minecraft/joinRequest.json");

class realmAPI extends XboxAPI {
    BaseUrl = "https://bedrock.frontendlegacy.realms.minecraft-services.net";
    SecondaryBaseUrl = "https://frontend.realms.minecraft-services.net";

    constructor(user = null, skipWhitelistCheck = false) {
        super(user);

        this.maxRetries = 7;
        this.user = user;
        this.skipWhitelistCheck = skipWhitelistCheck;
    }

    async init() {
        this.authToken = await this.getXboxToken("https://pocket.realms.minecraft.net/");

        this.id = null;
        this.realmAPIHeaders = {
            authorization: this.authToken,
            Accept: "*/*",
            charset: "utf-8",
            "client-ref": "7bc90e8887c29d13599eb19af6fc99c98dca4f9f",
            "client-version": "1.26.50",
            "x-networkprotocolversion": "2193",
            "x-clientplatform": AndroidDevice.deviceModel,
            "content-type": "application/json",
            "user-agent": AndroidDevice.userAgent,
            "Accept-Language": "en-US",
            "Accept-Encoding": "gzip, deflate, br",
            Host: "pocket.realms.minecraft.net",
            Connection: "Keep-Alive"
        };
    }

    async #req(path, options = {}, name = "") {
        const url = typeof path === "string" && path.startsWith("http") ? path : `https://${this.realmAPIHeaders.Host}${path}`;

        for (this.retryCount = -1; ; this.retryCount++) {
            if (this.retryCount > this.maxRetries) return { status: 429 };

            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        ...this.realmAPIHeaders,
                        ...options.headers
                    },
                    signal: AbortSignal.timeout(15000)
                });

                if (response.status === 429) return { status: response.status };

                if ([502, 503, 504].includes(response.status) || response.status >= 500) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    continue;
                }

                const contentType = response.headers.get("content-type") || "";
                const body = contentType.includes("application/json")
                    ? await response.json()
                    : await response.text();

                return { status: response.status, body };
            } catch (error) { console.error(`${name} failed request; `, error.message || error) }

            await new Promise(resolve => setTimeout(resolve, 3500));
        }
    }

    async get(path, name = "get") {
        return await this.#req(`${this.BaseUrl}${path}`, { method: "GET" }, name);
    }
    async post(path, name = "post", body = null) {
        return await this.#req(`${this.BaseUrl}${path}`, { method: "POST", body }, name);
    }
    async put(path, name = "put", body = null) {
        return await this.#req(`${this.BaseUrl}${path}`, { method: "PUT", body }, name);
    }
    async delete(path, name = "delete") {
        return await this.#req(`${this.BaseUrl}${path}`, { method: "DELETE" }, name);
    }

    async getRealmInfo(realmCode, fast = true, doChecks = false) {
        let response = await this.get(`/worlds/v1/link/${realmCode}`, "getRealmInfo");

        if (response.status !== 200 || fast)
            return doChecks ? this.doRealmChecks(response) : response;

        const body = response.body;

        if (!body?.member) {
            body.join = await this.joinRealm(realmCode);

            if (![200, 201, 204].includes(body.join?.status))
                return body;
        }

        const result = await this.getRealmInfoByID(body.id);

        return doChecks ? await this.doRealmChecks(result) : result;
    }

    async getRealmInfoByID(realmID, doChecks = false) {
        let response = await this.get(`/worlds/${realmID}`, "getRealmInfoByID");

        return doChecks ? await this.doRealmChecks(response) : response; 
    }

    async getActivePlayers(realmID = null) {
        let response = await this.get("/activities/live/players", "getActivePlayers");
        if (response.status !== 200 || !realmID) return response;

        return { ...response, body: response.body.servers.find((realm) => realm.id === Number(realmID)) || response.body };
    }

    async getRealmIP(realmID, doChecks = false) {
        let response = await this.post(`/worlds/${realmID}/join`, "getRealmIP", JSON.stringify(getRealmIPBody));
        return doChecks ? await this.doRealmChecks(null, response) : response
    }

    async postStorySettings(realmID, notifications = true, autostories = true, coordinates = true, timeline = true) {
        const body = JSON.stringify({ timeline, autostories, coordinates, notifications, playerOptIn: "OPT_IN", realmOptIn: "OPT_IN" });

        return await this.post(`/worlds/${realmID}/stories/settings`, "postStorySettings", body);
    }

    async getStorySettings(realmID) {
        return await this.get(`/worlds/${realmID}/stories/settings`, "getStorySettings");
    }

    async getWorlds() {
        return await this.get("/worlds", "getWorlds");
    }

    async getStory(realmID) {
        return await this.#req(`${this.SecondaryBaseUrl}/api/v1.0/worlds/${realmID}/stories`, { method: "GET" }, "getStory");
    }

    async joinRealm(realmCode) {
        return await this.post(`/invites/v1/link/accept/${realmCode}`, "joinRealm");
    }

    async leaveRealm(realmID) {
        return await this.delete(`/invites/${realmID}`, "leaveRealm");
    }

    async getInvites() {
        return await this.get("/invites/pending", "getInvites");
    }

    async acceptInvite(inviteID) {
        return await this.put(`/invites/accept/${inviteID}`, "acceptInvite");
    }

    async rejectInvite(inviteID) {
        return await this.put(`/invites/reject/${inviteID}`, "rejectInvite");
    }

    async getFeatureFlags() {
        return await this.get(`/feature/v1`);
    }

    async canClaimTrial() {
        return await this.get(`/trial/new`);
    }

    async getClientCompatible() {
        return await this.get("/mco/client/compatible", "getClientCompatible");
    }

    async getAllInvites() {
        return await this.get("/invites/all", "getAllInvites");
    }

    async getUserRole(xuid) {
        return await this.get(`/roles/user/${xuid}`, "getUserRole");
    }

    async getRealmTier(realmID) {
        return await this.get(`/worlds/${realmID}/configuration/tier`, "getRealmTier");
    }

    async getSubscriptionDetails(realmID) {
        return await this.get(`/subscriptions/${realmID}/details`, "getSubscriptionDetails");
    }

    async getPreferredRegions() {
        return await this.get("/regions/preferredRegions", "getPreferredRegions");
    }

    async updateRealmConfiguration(realmID, body = null) {
        return await this.put(`/worlds/${realmID}/configuration`, "updateRealmConfiguration", body === null ? null : JSON.stringify(body));
    }

    async setRenderDistance(realmID, distance) {
        return await this.put(`/worlds/${realmID}/configuration/renderDistance/${distance}`, "setRenderDistance");
    }

    async getRealmBackup(realmID, slot) {
        return await this.#req(`${this.SecondaryBaseUrl}/api/v1.0/worlds/${realmID}/backups/${slot}`, { method: "GET" }, "getRealmBackup");
    }

    async doRealmChecks(realm, host) {
        if (!realm && !host) return;

        let source;
        if (realm) {
            source = "realm"
            if (typeof realm.status === "number" && ![200, 201].includes(realm?.status)) {
                // since we only return the body *should do*, this should never be a value when passed through this.
                return { source, errorMsg: `${realm.body?.errorCode || realm.status || "No error Code"} >> ${httpsSTATUS[String(realm.body?.errorCode)] || "Unknown Status"}` };
            }

            if (realm.body?.errorMsg) return { source, errorMsg: `${realm.body.errorCode || "No error Code"} >> ${httpsSTATUS[String(realm.body.errorCode)] || "Unknown Status"}` }; // this should be handled above most part, just a catch if its not :)
            if (realm.body && realm.body?.id) realm = realm.body // we want to swap to a body, we dont need status from here

            if (!realm.id) return { source, errorMsg: "Woah no realm ID was found, please retry this command! 404" };
            if (realm.maxPlayers === 2) return { source, errorMsg: "Realm is a 2 player realm, can't be used with perxa! 501" };

            const IsWhitelisted = await RealmWhitelist.findOne({ id: String(realm.id) }).lean()
            if (IsWhitelisted?.id && !this.skipWhitelistCheck) return { source, errorMsg: "Realm is whitelisted, you cannot perform a operation on this realm!" };

            this.id = realm.id;
            realm.name = realm.name.replace(/[*_~`>|#[\]()\\|]/g, '').trim();
            realm.motd = realm.motd.replace(/[*_~`>|#[\]()\\|]/g, '').trim();
            if (!realm.name) realm.name = "realm name";
        }

        if (host) {
            source = "host"
            if (host?.body?.errorCode === 6015) {
                await this.postStorySettings(this.id, true, true, true, true);

                host = await this.getRealmIP(this.id);
            }

            if (host.status !== 200) return { source, errorMsg: `${host.status || host.body?.errorCode || "No error Code"} >> ${host.body?.errorMsg || httpsSTATUS[String(host.body?.errorCode || host.status)] || "Unknown Status"}` };
            if (!host.body || typeof host?.body.networkProtocol !== "string") return { source, errorMsg: "The realm networking Protocol wasnt a string, or was invalid, please try again later! 422" };

            if (!["NETHERNET", "DEFAULT", "NETHERNET_JSONRPC"].includes(host.body.networkProtocol)) return { source, errorMsg: "This realm is using a unsupported type of protocol. 501" };
            if (typeof host.body.address !== "string" || !host.body.address) return { source, errorMsg: "The realm address wasnt a string, or was invalid, please try again later! 422" };

            if (
                (host.body.networkProtocol === "DEFAULT" && !host.body.address.includes(":")) ||
                (host.body.networkProtocol.includes("NETHERNET") && !host.body.address.includes("-"))
            ) return { source, errorMsg: "It appears minecraft has sent an invalid address back for this networking type, please try again later. 501" };

            host = host.body;
        }

        return realm && host ? { realm, host } : host ? host : realm
    }
}

module.exports = realmAPI;