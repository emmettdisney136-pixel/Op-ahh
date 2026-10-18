'use strict'

const crypto = require('crypto')
const { Endpoints } = require('./constants')

const LiveTokenManager = require('./microsoft/LiveTokenManager')
const XboxTokenManager = require('./xbox/XboxTokenManager')
const PlayfabTokenManager = require('./playfab/PlayfabTokenManager')
const BedrockTokenManager = require('./minecraft/BedrockTokenManager')
const BedrockServicesTokenManager = require('./minecraft/BedrockServicesTokenManager')

class Authflow {
  constructor(username = '', cacheFactory, options = {}, codeCallback) {
    if (!cacheFactory) throw new Error('Authflow requires a cache factory')
    if (!options.flow) throw new Error("Missing 'flow' argument in options")

    this.username = username
    this.options = options
    this.codeCallback = codeCallback
    this.cache = cacheFactory()

    this.didInit = false
  }

  async init() {
    const { authTitle, flow = 'live' } = this.options

    if (!['live', 'sisu'].includes(flow)) throw new Error(`Unsupported authentication flow "${flow}"`)
    if (!authTitle) throw new Error(`authTitle is required for ${flow} flow`)

    this.msa = new LiveTokenManager(authTitle, ['service::user.auth.xboxlive.com::MBI_SSL'], this.cache)
    this.doTitleAuth = true
    const cached = await this.cache.getCached()
    let keyPair

    if (cached?.privateKey) {
      const privateKey = crypto.createPrivateKey({ key: cached.privateKey, format: 'jwk' })
      keyPair = { privateKey, publicKey: crypto.createPublicKey(privateKey) }
    } else {
      keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      await this.cache.setCachedPartial({
        privateKey: keyPair.privateKey.export({ format: 'jwk' })
      })
    }

    this.xbl = new XboxTokenManager(keyPair, this.cache)
    this.pfb = new PlayfabTokenManager(this.cache)
    this.bedrock = new BedrockTokenManager(this.cache)
    this.mcs = new BedrockServicesTokenManager(this.cache)
  }

  async getMsaToken() {
    if (await this.msa.verifyTokens()) return (await this.msa.getAccessToken()).token

    const result = await this.msa.authDeviceCode(response => {
      if (this.codeCallback) return this.codeCallback(response)
      console.info(response.message)
    })

    return result.accessToken
  }

  async getXboxToken(relyingParty = this.options.relyingParty || Endpoints.xbox.relyingParty, forceRefresh = false) {
    const options = { ...this.options, relyingParty }
    const cached = await this.xbl.getCachedTokens(relyingParty)

    if (cached.xstsToken.valid && !forceRefresh) return cached.xstsToken.data

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const msaToken = await this.getMsaToken()

        if (options.flow === 'sisu' && (!cached.userToken.valid || !cached.deviceToken.valid || !cached.titleToken.valid)) {
          const deviceToken = await this.xbl.getDeviceToken(options)
          return await this.xbl.doSisuAuth(msaToken, deviceToken, options)
        }

        const userToken = cached.userToken.token ?? await this.xbl.getUserToken(msaToken, options.flow === 'msal')
        const deviceToken = cached.deviceToken.token ?? await this.xbl.getDeviceToken(options)
        const titleToken = cached.titleToken.token ?? await this.xbl.getTitleToken(msaToken, deviceToken)

        return await this.xbl.getXSTSToken({ userToken, deviceToken, titleToken }, options)
      } catch (error) {
        if (attempt) throw error
        this.msa.forceRefresh = true
      }
    }
  }

  async getPlayfabLogin() {
    const cached = await this.pfb.getCachedAccessToken()
    if (cached.valid) return cached.data
    return this.pfb.getAccessToken(await this.getXboxToken(Endpoints.playfab.relyingParty))
  }

  async getMinecraftBedrockChain(publicKey) {
    if (!publicKey) throw new Error('publicKey is required')

    const response = await this.bedrock.getAccessToken(publicKey, await this.getXboxToken(Endpoints.minecraft.bedrock.relyingParty))

    if (!Array.isArray(response.chain)) throw new Error('Minecraft returned an invalid authentication chain')
    return response.chain
  }

  async getMinecraftBedrockServicesToken(options = {}) {
    const cached = await this.mcs.getCachedAccessToken()
    if (cached.valid) return cached.data

    const playfab = (await this.getPlayfabLogin())?.data
    if (!playfab?.SessionTicket) throw new Error('PlayFab did not return a SessionTicket')

    return this.mcs.getAccessToken(playfab.SessionTicket, options)
  }

  async getMinecraftBedrockMultiplayerToken(publicKey, options = {}) {
    if (!publicKey) throw new Error('publicKey is required')

    const services = await this.getMinecraftBedrockServicesToken(options)
    if (!services?.mcToken) throw new Error('Minecraft services did not return an mcToken')

    return this.mcs.getMultiplayerToken(services.mcToken, publicKey)
  }

  async getMinecraftBedrockToken(publicKey, options = {}) {
    return {
      chain: await this.getMinecraftBedrockChain(publicKey),
      token: await this.getMinecraftBedrockMultiplayerToken(publicKey, options)
    }
  }

  cancel() {
    this.msa.cancel()
  }
}

module.exports = Authflow