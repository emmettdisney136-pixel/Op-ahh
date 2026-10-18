'use strict'

const { Endpoints } = require('../constants')
const { checkStatus } = require('../utils')

class BedrockTokenManager {
  constructor(cache) { this.cache = cache }

  async getCachedAccessToken() {
    const data = (await this.cache.getCached())?.bedrock
    if (!data?.chain?.[0]) return { valid: false }

    const parts = data.chain[0].split('.')
    if (parts.length !== 3) return { valid: false }

    let payload
    try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) } 
    catch { return { valid: false } }

    const expires = Number(payload.exp || 0) * 1000
    return { valid: expires - Date.now() > 1000, until: new Date(expires), chain: data.chain }
  }

  async getAccessToken(publicKey, xsts) {
    if (!publicKey) throw new Error('A public key is required')

    const response = await fetch(Endpoints.minecraft.bedrock.authenticate, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MCPE/UWP',
        Authorization: `XBL3.0 x=${xsts.userHash};${xsts.XSTSToken}`
      },
      body: JSON.stringify({ identityPublicKey: publicKey })
    })

    const data = await checkStatus(response)
    await this.cache.setCachedPartial({ bedrock: data })
    return data
  }
}

module.exports = BedrockTokenManager