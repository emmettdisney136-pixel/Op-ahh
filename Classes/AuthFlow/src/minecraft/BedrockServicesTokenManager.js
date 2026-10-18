'use strict'

const { Endpoints } = require('../constants')
const { checkStatus } = require('../utils')

class BedrockServicesTokenManager {
  constructor(cache) { this.cache = cache }

  async getCachedAccessToken() {
    const data = (await this.cache.getCached())?.mcs
    if (!data) return { valid: false }

    const expires = new Date(data.validUntil)

    return {
      valid: expires.getTime() - Date.now() > 1000,
      until: expires,
      token: data.mcToken,
      data
    }
  }

  async getAccessToken(sessionTicket, options = {}) {
    const response = await fetch(Endpoints.minecraft.bedrock.services, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device: {
          applicationType: options.applicationType ?? 'MinecraftPE',
          gameVersion: options.version ?? '1.20.62',
          id: options.deviceId ?? 'c1681ad3-415e-30cd-abd3-3b8f51e771d1',
          memory: options.deviceMemory ?? String(8 * (1024 * 1024 * 1024)),
          platform: options.platform ?? 'Windows10',
          playFabTitleId: options.playFabtitleId ?? '20CA2',
          storePlatform: options.storePlatform ?? 'uwp.store',
          type: options.type ?? 'Windows10'
        },
        user: {
          token: sessionTicket,
          tokenType: 'PlayFab'
        }
      })
    })

    const data = await checkStatus(response)
    const result = {
      mcToken: data.result.authorizationHeader,
      validUntil: data.result.validUntil,
      treatments: data.result.treatments,
      configurations: data.result.configurations,
      treatmentContext: data.result.treatmentContext
    }

    await this.cache.setCachedPartial({ mcs: result })
    return result
  }

  async getMultiplayerToken(serviceToken, publicKey) {
    const response = await fetch(Endpoints.minecraft.bedrock.multiplayer, {
      method: 'POST',
      headers: {
        accept: '*/*',
        authorization: serviceToken,
        'content-type': 'application/json',
        'User-Agent': 'libhttpclient/1.0.0.0',
        'Accept-Language': 'en-US',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      body: JSON.stringify({ publicKey })
    })

    const data = await checkStatus(response)
    return data?.result?.signedToken || data?.signedToken || ''
  }
}

module.exports = BedrockServicesTokenManager