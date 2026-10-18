'use strict'

const crypto = require('crypto')
const { Endpoints } = require('../constants')
const { checkStatus } = require('../utils')

class XboxTokenManager {
  constructor(keyPair, cache) {
    this.keyPair = keyPair
    this.cache = cache
    this.jwk = { ...keyPair.publicKey.export({ format: 'jwk' }), alg: 'ES256', use: 'sig' }
    this.headers = {
      'Cache-Control': 'no-store, must-revalidate, no-cache',
      'x-xbl-contract-version': '1'
    }
  }

  async getCachedTokens(relyingParty) {
    const cached = await this.cache.getCached()
    const data = cached?.xbl || cached
    const result = {}

    for (const name of ['userToken', 'deviceToken', 'titleToken']) {
      const token = data?.[name]
      const valid = token && new Date(token.NotAfter).getTime() - Date.now() > 1000
      result[name] = valid ? { valid: true, token: token.Token, data: token } : { valid: false }
    }

    const hash = crypto.createHash('sha256').update(String(relyingParty)).digest('hex')
    const xsts = data?.[hash]
    const valid = xsts && new Date(xsts.expiresOn).getTime() - Date.now() > 1000

    result.xstsToken = valid ? { valid: true, data: xsts } : { valid: false }
    return result
  }

  sign(url, authorizationToken, payload) {
    const windowsTimestamp = (BigInt((Date.now() / 1000) | 0) + 11644473600n) * 10000000n
    const path = new URL(url).pathname

    const version = Buffer.alloc(5)
    version.writeInt32BE(1, 0)

    const timestamp = Buffer.alloc(9)
    timestamp.writeBigUInt64BE(windowsTimestamp)
    timestamp.writeUInt8(0, 8)

    const message = Buffer.concat([
      version,
      timestamp,
      Buffer.from('POST\0'),
      Buffer.from(path + '\0'),
      Buffer.from(authorizationToken + '\0'),
      Buffer.from(payload + '\0')
    ])

    const signature = crypto.sign('SHA256', message, { key: this.keyPair.privateKey, dsaEncoding: 'ieee-p1363' })

    const header = Buffer.alloc(12 + signature.length)
    header.writeInt32BE(1, 0)
    header.writeBigUInt64BE(windowsTimestamp, 4)
    signature.copy(header, 12)

    return header
  }

  createXboxTokenError(error) {
    let code;
    const header = Number.parseInt(error.response?.headers.get('x-err'), 10)
    if (Number.isInteger(header)) code = header

    const body = Number.parseInt(error.data?.XErr, 10)
    if (Number.isInteger(body)) code = body

    if (!code) return error

    const errors = {
      2148916227: 'Your account was banned by Xbox for violating one or more Community Standards for Xbox and is unable to be used.',
      2148916229: 'Your account is currently restricted and your guardian has not given you permission to play online.',
      2148916233: 'Your account currently does not have an Xbox profile. Please create one at https://signup.live.com/signup',
      2148916234: "Your account has not accepted Xbox's Terms of Service.",
      2148916235: 'Your account resides in a region that Xbox has not authorized use from.',
      2148916236: 'Your account requires proof of age.',
      2148916237: 'Your account has reached its limit for playtime.',
      2148916238: 'The account date of birth is under 18 years and cannot proceed unless the account is added to a family by an adult.'
    }

    const xboxError = new Error(errors[code] || `Xbox Live authentication failed to obtain a XSTS token. XErr: ${code}`)
    xboxError.cause = error
    xboxError.response = error.response
    xboxError.body = error.body
    xboxError.data = error.data
    xboxError.errorCode = code

    return xboxError
  }

  async getUserToken(msaToken, azure = false) {
    const body = JSON.stringify({
      RelyingParty: Endpoints.xbox.userAuth,
      TokenType: 'JWT',
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `${azure ? 'd=' : 't='}${msaToken}`
      }
    })

    const Signature = this.sign(Endpoints.xbox.userAuth, '', body).toString('base64')
    const response = await fetch(Endpoints.xbox.userAuth, { method: 'POST', headers: { ...this.headers, 'x-xbl-contract-version': '2', Signature }, body })

    const token = await checkStatus(response)
    await this.cache.setCachedPartial({ userToken: token })
    return token.Token
  }

  async getDeviceToken(options = {}) {
    const body = JSON.stringify({
      Properties: {
        AuthMethod: 'ProofOfPossession',
        Id: `{${crypto.randomUUID()}}`,
        DeviceType: options.deviceType || 'Nintendo',
        SerialNumber: `{${crypto.randomUUID()}}`,
        Version: options.deviceVersion || '0.0.0',
        ProofKey: this.jwk
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })

    const Signature = this.sign(Endpoints.xbox.deviceAuth, '', body).toString('base64')
    const response = await fetch(Endpoints.xbox.deviceAuth, { method: 'POST', headers: { ...this.headers, Signature }, body })

    const token = await checkStatus(response)
    await this.cache.setCachedPartial({ deviceToken: token })
    return token.Token
  }

  async getTitleToken(msaToken, deviceToken) {
    const body = JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        DeviceToken: deviceToken,
        RpsTicket: `t=${msaToken}`,
        SiteName: 'user.auth.xboxlive.com',
        ProofKey: this.jwk
      },
      RelyingParty: Endpoints.xbox.authRelyingParty,
      TokenType: 'JWT'
    })

    const Signature = this.sign(Endpoints.xbox.titleAuth, '', body).toString('base64')
    const response = await fetch(Endpoints.xbox.titleAuth, { method: 'POST', headers: { ...this.headers, Signature }, body })

    const token = await checkStatus(response)
    await this.cache.setCachedPartial({ titleToken: token })
    return token.Token
  }

  async doSisuAuth(msaToken, deviceToken, options = {}) {
    const body = JSON.stringify({
      AccessToken: `t=${msaToken}`,
      AppId: options.authTitle,
      DeviceToken: deviceToken,
      Sandbox: 'RETAIL',
      UseModernGamertag: true,
      SiteName: 'user.auth.xboxlive.com',
      RelyingParty: options.relyingParty,
      ProofKey: this.jwk
    })

    const Signature = this.sign(Endpoints.xbox.sisuAuthorize, '', body).toString('base64')

    try {
      const response = await fetch(Endpoints.xbox.sisuAuthorize, { method: 'POST', headers: { Signature }, body })

      const data = await checkStatus(response)
      const auth = data.AuthorizationToken
      const xui = auth.DisplayClaims.xui[0]

      const xsts = {
        userXUID: xui.xid || null,
        userHash: xui.uhs,
        XSTSToken: auth.Token,
        expiresOn: auth.NotAfter
      }

      const hash = crypto.createHash('sha256').update(String(options.relyingParty)).digest('hex')

      await this.cache.setCachedPartial({
        userToken: data.UserToken,
        titleToken: data.TitleToken,
        [hash]: xsts
      })

      return xsts
    } catch (error) {
      throw this.createXboxTokenError(error)
    }
  }

  async getXSTSToken(tokens, options = {}) {
    const body = JSON.stringify({
      RelyingParty: options.relyingParty,
      TokenType: 'JWT',
      Properties: {
        UserTokens: [tokens.userToken],
        DeviceToken: tokens.deviceToken,
        TitleToken: tokens.titleToken,
        OptionalDisplayClaims: options.optionalDisplayClaims,
        ProofKey: this.jwk,
        SandboxId: 'RETAIL'
      }
    })

    const Signature = this.sign(Endpoints.xbox.xsts, '', body).toString('base64')

    try {
      const response = await fetch(Endpoints.xbox.xsts, { method: 'POST', headers: { ...this.headers, Signature }, body })

      const data = await checkStatus(response)
      const xui = data?.DisplayClaims?.xui?.[0]

      const result = {
        userXUID: xui?.xid || null,
        userHash: xui?.uhs,
        XSTSToken: data.Token,
        expiresOn: data.NotAfter
      }

      const hash = crypto.createHash('sha256').update(String(options.relyingParty)).digest('hex')
      await this.cache.setCachedPartial({ [hash]: result })

      return result
    } catch (error) {
      throw this.createXboxTokenError(error)
    }
  }
}

module.exports = XboxTokenManager