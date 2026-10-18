'use strict'

const { Endpoints } = require('../constants')
const { checkStatus } = require('../utils')

class PlayfabTokenManager {
  constructor(cache) { this.cache = cache }

  async getCachedAccessToken() {
    const data = (await this.cache.getCached())?.pfb
    if (!data) return { valid: false }

    const expires = new Date(data.EntityToken?.TokenExpiration)
    return { valid: expires.getTime() - Date.now() > 1000, until: expires, data }
  }

  async getAccessToken(xsts) {
    if (!xsts?.userHash || !xsts?.XSTSToken) throw new Error('Invalid XSTS token')

    const response = await fetch(Endpoints.playfab.loginWithXbox, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        CreateAccount: true,
        EncryptedRequest: null,
        InfoRequestParameters: {
          GetCharacterInventories: false,
          GetCharacterList: false,
          GetPlayerProfile: true,
          GetPlayerStatistics: false,
          GetTitleData: false,
          GetUserAccountInfo: true,
          GetUserData: false,
          GetUserInventory: false,
          GetUserReadOnlyData: false,
          GetUserVirtualCurrency: false,
          PlayerStatisticNames: null,
          ProfileConstraints: null,
          TitleDataKeys: null,
          UserDataKeys: null,
          UserReadOnlyDataKeys: null
        },
        PlayerSecret: null,
        TitleId: '20CA2',
        XboxToken: `XBL3.0 x=${xsts.userHash};${xsts.XSTSToken}`
      })
    })

    const data = await checkStatus(response)
    await this.cache.setCachedPartial({ pfb: data })
    return data
  }
}

module.exports = PlayfabTokenManager