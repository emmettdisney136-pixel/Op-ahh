const XboxAPI = require('./Xbox');
const fs = require("fs");

const DefaultSkin = require('../Data/minecraft/skins/Steve.json');

class PlayFabAPI extends XboxAPI {
    apiUrl = "https://20ca2.playfabapi.com";
    personaUrl = "https://persona-secondary.franchise.minecraft-services.net";

    constructor(user) {
        super(user);

        this.api_headers = {
            "Accept": "application/json",
            "content-type": "application/json",
            "User-Agent": "libhttpclient/1.0.0.0",
            "Accept-Language": "en-US",
            "x-playfabsdk": "XPlatCppSdk-3.6.190304",
            "Accept-Encoding": "gzip, deflate, br",
            "Host": "20ca2.playfabapi.com",
            "Connection": "Keep-Alive",
            "Cache-Control": "no-cache"
        };
    }

    async loginWithXbox() {
        const authToken = await this.getXboxToken("https://b980a380.minecraft.playfabapi.com/");

        if (authToken?.errorMsg) return authToken;

        const body = JSON.stringify({
            CreateAccount: true,
            InfoRequestParameters: {
                GetPlayerProfile: true,
                GetUserAccountInfo: true
            },
            TitleId: "20CA2",
            XboxToken: authToken
        }, null, 2);

        const response = await fetch(`${this.apiUrl}/Client/LoginWithXbox`, {
            method: "POST",
            headers: this.api_headers,
            body
        });

        const data = await response.json();

        return data?.data ? data.data : data;
    }

    async playFabRequest(endpoint, body = {}, authData = null) {
        if (!authData) authData = await this.loginWithXbox();
        if (authData?.errorMsg) return authData;

        const response = await fetch(`${this.apiUrl}${endpoint}`, {
            method: "POST",
            headers: {
                ...this.api_headers,
                "x-authorization": authData.SessionTicket
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.status !== "OK") return { errorMsg: `${data.code} ${data.status}. Error: ${data.errorMessage}`, errorCode: data.errorCode || data.code };

        return data.data;
    }

    async getPersonaToken() {
        const tokenData = await this.flow.getMinecraftBedrockServicesToken({ version: "1.26.21" });

        const token = tokenData?.mcToken;

        if (token?.errorMsg || typeof token !== "string") return token || tokenData;

        return token;
    }

    async personaRequest(path, options = {}) {
        const token = await this.getPersonaToken();

        if (token?.errorMsg || typeof token !== "string") return token;

        const res = await fetch(`${this.personaUrl}${path}`, {
            ...options,
            headers: {
                Authorization: token,
                "User-Agent": "libhttpclient/1.0.0.0",
                ...options.headers
            }
        });

        const contentType = res.headers.get("content-type") ?? "";

        if (contentType.startsWith("image/") || contentType === "application/octet-stream") return Buffer.from(await res.arrayBuffer());

        if (contentType.includes("application/json")) return await res.json();

        return await res.text();
    }

    async getPublisherData() {
        const authData = await this.loginWithXbox();
        if (authData?.errorMsg) return authData;

        const response = await fetch(`${this.apiUrl}/Client/GetUserPublisherData`, {
            method: "POST",
            headers: {
                ...this.api_headers,
                "x-authorization": authData.SessionTicket
            }
        });

        const data = await response.json();

        if (data.status !== "OK") return { errorMsg: `${data.code} ${data.status}. ` + `errormessage: ${data.errorMessage} getPublisherData` };

        return data.data;
    }

    async updatePublisherData() {
        const authData = await this.loginWithXbox();
        if (authData?.errorMsg) return authData;

        const publisherData = await this.getPublisherData();

        if (!publisherData || !publisherData.Data) return { errorMsg: "failed to get publisher data" };

        const profile = await this.getXboxUser(authData.InfoResultPayload?.AccountInfo?.XboxInfo?.XboxUserId);

        if (!profile) return { errorMsg: "failed to get xbox user data" };

        if (
            publisherData?.Data?.GamertagHint?.Value === profile.gamertag &&
            publisherData?.Data?.DataVersion >= 1
        ) return { msg: "No update was needed, gamertag and version match" };

        const body = JSON.stringify({
            Data: { GamertagHint: profile.gamertag },
            Entity: {
                Id: authData?.PlayFabId,
                Type: "master_player_account"
            },
            Permission: "Public"
        }, null, 2);

        const response = await fetch(`${this.apiUrl}/Client/UpdateUserPublisherData`, {
            method: "POST",
            headers: {
                ...this.api_headers,
                "x-authorization": authData.SessionTicket
            },
            body
        });

        const data = await response.json();

        if (data.status !== "OK") return { errorMsg: `${data.code} ${data.status}. ` + `errormessage: ${data.errorMessage} updatePublisherData` };

        return data;
    }

    async getCurrency() {
        const authData = await this.loginWithXbox();
        if (authData?.errorMsg) return authData;

        const response = await fetch(`${this.apiUrl}/inventory/GetVirtualCurrencies`, {
            method: "POST",
            headers: {
                ...this.api_headers,
                "x-entitytoken": authData.EntityToken?.EntityToken
            }
        });

        const data = await response.json();

        if (data.status !== "OK") return { errorMsg: `${data.code} ${data.status}. ` + `errormessage: ${data.errorMessage} getCurrency` };

        return data;
    }

    async getAccountInfo(playFabId = null) {
        const body = {};

        if (playFabId) body.PlayFabId = playFabId;

        return await this.playFabRequest("/Client/GetAccountInfo", body);
    }

    async getPlayerProfile(playFabId = null) {
        const body = {};

        if (playFabId) body.PlayFabId = playFabId;

        return await this.playFabRequest("/Client/GetPlayerProfile", body);
    }

    async getUserPlayFabId(xuid) {
        return await this.playFabRequest("/Client/GetPlayFabIDsFromXboxLiveIDs", { XboxLiveAccountIDs: [xuid], Sandbox: "RETAIL" });
    }

    async getPlayFabIDsFromXboxLiveIDs(xuids) {
        if (!Array.isArray(xuids)) xuids = [xuids];

        return await this.playFabRequest("/Client/GetPlayFabIDsFromXboxLiveIDs", { XboxLiveAccountIDs: xuids, Sandbox: "RETAIL" });
    }

    async getCombinedInfo(playFabId = null, infoRequestParameters = {}) {
        const body = {
            InfoRequestParameters: {
                GetPlayerProfile: true,
                GetUserAccountInfo: true,
                ...infoRequestParameters
            }
        };

        if (playFabId) body.PlayFabId = playFabId;

        return await this.playFabRequest("/Client/GetPlayerCombinedInfo", body);
    }

    async getUserData(playFabId = null, keys = null) {
        const body = {};

        if (playFabId) body.PlayFabId = playFabId;

        if (Array.isArray(keys)) body.Keys = keys;

        return await this.playFabRequest("/Client/GetUserData", body);
    }

    async updateUserData(data = {}, permission = "Private", keysToRemove = null) {
        const body = { Data: data, Permission: permission };

        if (Array.isArray(keysToRemove)) body.KeysToRemove = keysToRemove;

        return await this.playFabRequest("/Client/UpdateUserData", body);
    }

    async getUserReadOnlyData(playFabId = null, keys = null) {
        const body = {};

        if (playFabId) body.PlayFabId = playFabId;

        if (Array.isArray(keys)) body.Keys = keys;

        return await this.playFabRequest("/Client/GetUserReadOnlyData", body);
    }

    async getUserInventory() {
        return await this.playFabRequest("/Client/GetUserInventory", {});
    }

    async getPlayerStatistics(statisticNames = null) {
        const body = {};

        if (Array.isArray(statisticNames)) body.StatisticNames = statisticNames;

        return await this.playFabRequest("/Client/GetPlayerStatistics", body);
    }

    async getTitleData(keys = null) {
        const body = {};

        if (Array.isArray(keys)) body.Keys = keys;

        return await this.playFabRequest("/Client/GetTitleData", body);
    }

    async getCatalogItems(catalogVersion = null) {
        const body = {};

        if (catalogVersion) body.CatalogVersion = catalogVersion;

        return await this.playFabRequest("/Client/GetCatalogItems", body);
    }

    async getUserFeatured(xuid) {
        return await this.personaRequest(`/api/v1.0/gallery/featured/xuid/${xuid}`, { method: "GET" });
    }

    async getUserGallery(xuid) {
        return await this.personaRequest(`/api/v1.0/gallery/xuid/${xuid}`, { method: "GET" });
    }

    async getUserGalleryLimit(xuid) {
        return await this.personaRequest(`/api/v1.0/gallery/size/xuid/${xuid}`, { method: "GET" });
    }

    async getUsersHeadXUID(xuid) {
        return await this.personaRequest(`/api/v1.0/profile/xuid/${xuid}/image/head`, { method: "GET" });
    }

    async getUsersAvatar(xuid) {
        return await this.personaRequest(`/api/v1.0/profile/xuid/${xuid}/image/avatar`, { method: "GET" });
    }

    async getMyAppearance() {
        return await this.personaRequest("/api/v1.0/appearance", { method: "GET" });
    }

    async uploadGalleryImage(imageBuffer, featured = true, timeTaken = new Date().toISOString()) {
        if (!imageBuffer) imageBuffer = fs.readFileSync("./Data/minecraft/Images/banner.png");
        if (!Buffer.isBuffer(imageBuffer)) return { errorMsg: "imageBuffer must be a Buffer" };

        return await this.personaRequest("/api/v1.0/gallery", {
            method: "POST",
            headers: {
                "Content-Type": "application/octet-stream",
                "x-ms-showcased-featured": String(featured),
                "x-ms-showcased-timetaken": timeTaken,
                "Content-Length": String(imageBuffer.length)
            },
            body: imageBuffer
        });
    }

    async uploadSkin(uploadSkin = DefaultSkin) {
        const body = fs.readFileSync("./Data/minecraft/skins/apperanceObjects.json", "utf8")
            .replaceAll("c18e65aa-7b21-4637-9b63-8ad63622ef01", uploadSkin.PersonaPieces?.[0]?.PackId);

        return await this.personaRequest("/api/v1.0/appearance", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    }
}

module.exports = PlayFabAPI;