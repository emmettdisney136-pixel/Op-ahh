const Authflow = require("./AuthFlow/index");
const { cacheFactory } = require("../Data/JS/Database");

const AndroidDevice = require("../Data/JS/Devices").android

class XboxAPI {
    peopleHub = "https://peoplehub.xboxlive.com";
    profile = "https://profile.xboxlive.com";
    userPresence = "https://userpresence.xboxlive.com";
    clubPresence = "https://clubpresence.xboxlive.com";
    titleHub = "https://titlehub.xboxlive.com";
    clubHub = "https://clubhub.xboxlive.com";
    userStats = "https://userstats.xboxlive.com";
    achievements = "https://achievements.xboxlive.com";

    constructor(user) {
        this.user = user;

        this.maxRetries = 3;
        this.xuid = null;

        this.flow = new Authflow(undefined, cacheFactory(this.user), {
            flow: AndroidDevice.flow,
            authTitle: AndroidDevice.authTitle,
            deviceType: AndroidDevice.deviceType
        });

        this.headers = {
            "x-xbl-contract-version": 3,
            "Accept-Encoding": "gzip, deflate",
            "Accept": "application/json",
            "Accept-Language": "en-US",
            "User-Agent": "WindowsGameBar/5.823.1271.0"
        };
    }

    async #req(url, options = {}, name = "") {
        const authToken = await this.getXboxToken();
        if (authToken?.errorMsg || typeof authToken !== "string") return authToken;

        this.headers["Authorization"] = authToken;

        const host = new URL(url).host;
        this.headers.Host = host;

        for (let retry = 0; retry <= this.maxRetries; retry++) {
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        ...this.headers,
                        ...options.headers
                    },
                    signal: AbortSignal.timeout(15000)
                });

                if ([502, 503, 504].includes(response.status) || response.status >= 500) {
                    await this.#delay(1500);
                    continue;
                }

                if (response.status === 204) return { status: 204, body: "success" };

                const text = await response.text();

                let body;
                try { body = JSON.parse(text); }
                catch { body = text || null; }

                return { status: response.status, body };
            } catch (error) {
                if (error.name === "AbortError" || error.name === "TimeoutError") {
                    console.error(`${name} timed out, retrying...`);
                    await this.#delay(1000);
                } else {
                    console.error(`${name} failed request:`, error.message || error);
                    throw error;
                }
            }

            if (retry < this.maxRetries) await this.#delay(3500);
        }

        return { status: 429, body: { errorMsg: "Perxa- has ratelimited your xbox requests, try again later." } };
    }

    #delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async getXboxToken(relyingParty) {
        try {
            if (!this.flow.didInit) await this.flow.init();

            const xboxToken = await this.flow.getXboxToken(relyingParty);
            if (xboxToken?.userXUID) this.xuid = xboxToken.userXUID;

            return `XBL3.0 x=${xboxToken.userHash};${xboxToken.XSTSToken}`;
        } catch (error) {
            console.log(error)
            return { errorMsg: error.message };
        }
    }

    async getXboxUserBulk(xuids = []) {
        if (!xuids.length) return null;

        const response = await this.#req(`${this.peopleHub}/users/me/people/batch/decoration/detail,presenceDetail`, {
            method: "POST",
            body: JSON.stringify({ xuids }),
            headers: { "x-xbl-contract-version": "4" }
        }, "getXboxUserBulk");

        return response?.body?.people || response;
    }

    async getXboxUser(xuid) {
        if (!xuid) return;

        const response = await this.#req(`${this.peopleHub}/users/me/people/xuids(${xuid})/decoration/detail,preferredColor,presenceDetail`, {}, "getXboxUser");

        return response?.body || response;
    }

    async gamertagToXuid(gamertag) {
        const response = await this.#req(`${this.profile}/users/gt(${encodeURIComponent(gamertag)})/profile/settings`, {}, "gamertagToXuid");

        return response?.body?.profileUsers?.[0]?.id || response;
    }

    async sendPresence(body) {
        return await this.#req(`${this.userPresence}/users/xuid(${this.xuid})/devices/current/titles/current`, {
            method: "POST",
            body: JSON.stringify(body)
        }, "sendPresence");
    }

    async sendInGamePresence(realm, inGame) {
        return await this.#req(`${this.clubPresence}/clubs/${realm.clubId}/users/xuid(${this.xuid})/session?titleFamilyId=3347393a-1a27-4e26-a623-31173bb86ee1`, {
            method: "POST",
            body: JSON.stringify({ inGame })
        }, "sendInGamePresence");
    }

    async sendInGamePresenceRealm(realm, device = AndroidDevice) {
        await this.sendPresence({
            state: "active",
            activity: { richPresence: { id: `Realm_${realm.gamemode}`, scid: device.scid } }
        });

        await this.sendInGamePresence(realm, true);
    }

    async getTitleHistory(xuid) {
        if (!xuid) return;

        return await this.#req(`${this.titleHub}/users/xuid(${xuid})/titles/titleHistory/decoration/GamePass,TitleHistory,Achievement,Stats`, {
            method: "GET",
            headers: { "x-xbl-contract-version": 2 }
        }, "getTitleHistory");
    }

    async getClubData(clubId) {
        if (!clubId) return;

        return await this.#req(`${this.clubHub}/clubs/Ids(${clubId})/decoration/clubPresence`, {
            method: "GET",
            headers: { "Signature": "", "x-xbl-contract-version": 4 }
        }, "getClubData");
    }

    async getAchievements(xuid, titleId = "1739947436", types = "Persistent", maxItems = 25) {
        return await this.#req(`${this.achievements}/users/xuid(${xuid})/achievements?titleId=${titleId}&types=${types}&maxItems=${maxItems}`, { method: "GET" }, "getAchievements");
    }

    async getCurrentPlaying(xuid) {
        return await this.#req(`${this.userPresence}/users/batch`, {
            method: "POST",
            body: JSON.stringify({
                users: typeof xuid === "string" ? [xuid] : xuid,
                level: "all",
                onlineOnly: false,
                broadcastingOnly: false
            })
        }, "getCurrentPlaying");
    }

    async screenShotsCreate(fileSize, resolutionHeight, resolutionWidth, thumbnailFileSize) {
        const response = await this.#req(
            "https://mediahub.xboxlive.com/screenshots/create",
            {
                method: "POST",
                headers: {
                    "x-xbl-contract-version": "3",
                    "Content-Type": "application/json",
                    "Accept-Language": "en-GB",
                    "User-Agent": "libhttpclient/1.0.0.0"
                },
                body: JSON.stringify({
                    expectedBlocks: 1,
                    fileSize: Number(fileSize),
                    initialMetadata: {
                        creationType: "UserGenerated",
                        resolutionHeight: Number(resolutionHeight),
                        resolutionWidth: Number(resolutionWidth),
                        titleId: AndroidDevice.titleId
                    },
                    thumbnailFileSize: Number(thumbnailFileSize),
                    thumbnailNumBlocks: 1
                })
            },
            "screenShotsCreate"
        );

        return response?.body ?? response;
    }

    async uploadImageToXboxLive(imageBuffer) {
        if (!imageBuffer?.byteLength) return { errorMsg: "Invalid or empty image buffer" };

        const fileSize = imageBuffer.byteLength;
        const screenshot = await this.screenShotsCreate(fileSize, 1080, 1920, fileSize);
        if (screenshot?.errorMsg) return screenshot;

        const upload = async (url, msDate) => {
            const response = await fetch(
                `${url}&comp=block&blockId=${encodeURIComponent(Buffer.from("BlockId0000001").toString("base64"))}`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/octet-stream",
                        "Accept-Language": "en-GB",
                        "User-Agent": "libhttpclient/1.0.0.0",
                        "x-ms-version": "2015-12-11",
                        "x-xbl-contract-version": "3",
                        "x-ms-date": msDate
                    },
                    body: imageBuffer
                }
            );

            if (response.status !== 201) {
                return {
                    errorMsg:
                        `${response.status} ${response.statusText} ` +
                        `${await response.text()} WENT WRONG ON UPLOAD`
                };
            }

            return null;
        };

        const thumbnailError = await upload(screenshot.thumbnailUploadUri, "3");

        if (thumbnailError) return thumbnailError;
        const contentError = await upload(screenshot.contentUploadUri, "placeholder");

        if (contentError) return contentError;

        const token = await this.getXboxToken();

        if (typeof token !== "string") return token;
        const response = await fetch(screenshot.publishUri, {
            method: "POST",
            headers: {
                Authorization: token,
                "x-xbl-contract-version": "2",
                "Accept-Language": "en-GB",
                "User-Agent": "libhttpclient/1.0.0.0"
            }
        });

        const text = await response.text();

        let result;

        try { result = JSON.parse(text) }
        catch { result = text || null }

        if (!response.ok) return { errorMsg: `${JSON.stringify(result)} WENT WRONG ON PUBLISH` };

        return result;
    }

    async sendMessageToClub(message, clubId, image = null) {
        let imageData = null;
        if (image) {
            imageData = await this.uploadImageToXboxLive(image);

            if (imageData?.errorMsg) return imageData;
        }

        const token = await this.getXboxToken();
        if (typeof token !== "string") return token;

        const post = {
            postText: message,
            postType: imageData ? "XboxLink" : "Text",
            timelines: [{ timeLineOwner: clubId, timeLineType: "Club" }]
        };

        if (imageData?.contentId) {
            post.postTypeData = {
                locator:
                    `screenshotsmetadata.xboxlive.com/` +
                    `users/xuid(${this.xuid})/` +
                    `scids/00000000-0000-0000-0000-000000000000/` +
                    `screenshots/${imageData.contentId}`
            };
        }

        const response = await fetch(
            "https://userposts.xboxlive.com/users/me/posts",
            {
                method: "POST",
                headers: {
                    Authorization: token,
                    "x-xbl-contract-version": "2",
                    "Content-Type": "application/json",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Cache-Control": "no-cache",
                    "User-Agent": "libhttpclient/1.0.0.0"
                },
                body: JSON.stringify(post)
            }
        );

        const text = await response.text();

        let result;
        try { result = JSON.parse(text); } 
        catch { result = text || null; }

        if (!response.ok) 
            return { ...(typeof result === "object" && result ? result : {}), errorMsg: `${JSON.stringify(result)} on posting ${response.status} ${response.text}` };

        return result;
    }

}

module.exports = XboxAPI;