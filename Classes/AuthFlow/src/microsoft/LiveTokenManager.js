'use strict'

const { Endpoints } = require('../constants')
const { checkStatus } = require('../utils')

class LiveTokenManager {
  constructor(clientId, scopes, cache) {
    if (!clientId) throw new Error('Microsoft client ID is required')
    if (!cache) throw new Error('LiveTokenManager requires a cache')

    this.clientId = clientId
    this.scopes = Array.isArray(scopes) ? scopes.join(' ') : scopes
    this.cache = cache
    this.polling = false
    this.forceRefresh = false
  }

  async getAccessToken() {
    const token = (await this.cache.getCached())?.token
    if (!token?.access_token) return

    const until = Number(token.obtainedOn || 0) + Number(token.expires_in || 0) * 1000 - Date.now()

    return {
      valid: until > 1000,
      until,
      token: token.access_token
    }
  }

  async getRefreshToken() {
    const token = (await this.cache.getCached())?.token
    return token?.refresh_token ? { valid: true, token: token.refresh_token } : undefined
  }

  async updateCache(token) {
    await this.cache.setCachedPartial({ token: { ...token, obtainedOn: Date.now() } })
  }

  async verifyTokens() {
    if (this.forceRefresh) {
      try {
        await this.refreshTokens()
      } catch {}
    }

    const access = await this.getAccessToken()
    const refresh = await this.getRefreshToken()

    if (!access || !refresh) return false
    if (access.valid) return true

    try {
      await this.refreshTokens()
      return !!(await this.getAccessToken())?.valid
    } catch {
      return false
    }
  }

  async refreshTokens() {
    const refresh = await this.getRefreshToken()
    if (!refresh) throw new Error('Cannot refresh Microsoft token without a refresh token')

    const body = new URLSearchParams({
      scope: this.scopes,
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: refresh.token
    })

    const response = await fetch(Endpoints.live.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })

    const token = await checkStatus(response)
    await this.updateCache(token)
    return token
  }

  async authDeviceCode(callback) {
    if (typeof callback !== 'function') throw new TypeError('authDeviceCode requires a callback')

    const body = new URLSearchParams({
      scope: this.scopes,
      client_id: this.clientId,
      response_type: 'device_code'
    })

    const response = await fetch(Endpoints.live.deviceCode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })

    const device = await checkStatus(response)

    if (!device?.device_code || !device?.user_code) {
      throw new Error('Microsoft returned an invalid device-code response')
    }

    device.message = `To sign in, open ${device.verification_uri} and enter the code ${device.user_code}.`
    callback(device)

    let interval = Math.max(1, Number(device.interval || 5))
    const expiresAt = Date.now() + Number(device.expires_in || 900) * 1000

    this.polling = true

    while (this.polling && Date.now() < expiresAt) {
      await new Promise(resolve => setTimeout(resolve, interval * 1000))
      if (!this.polling) break

      const requestBody = new URLSearchParams({
        client_id: this.clientId,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })

      const response = await fetch(Endpoints.live.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: requestBody
      })

      const token = await response.json()

      if (token.error === 'authorization_pending') continue

      if (token.error === 'slow_down') {
        interval += 5
        continue
      }

      if (token.error) {
        throw new Error(`Microsoft authentication failed: ${token.error}${token.error_description ? ` - ${token.error_description}` : ''}`)
      }

      if (!token.access_token) continue

      await this.updateCache(token)
      this.polling = false

      return { accessToken: token.access_token }
    }

    this.polling = false
    throw new Error('Microsoft device authentication timed out')
  }

  cancel() { this.polling = false }
}

module.exports = LiveTokenManager