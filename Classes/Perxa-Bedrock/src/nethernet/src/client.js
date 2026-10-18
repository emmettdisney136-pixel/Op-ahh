const { EventEmitter } = require('node:events')
const crypto = require('node:crypto')
const { RTCPeerConnection, RTCIceCandidate } = require('@roamhq/wrtc')
const { Connection } = require('./connection')
const { SignalStructure } = require('./signalling')

class Client extends EventEmitter {
  constructor(networkId, token, ecdhKeyPair) {
    super()
    this.serverNetworkId = String(networkId)
    this.token = token
    this.ecdhKeyPair = ecdhKeyPair
    this.networkId = crypto.randomBytes(8).readBigUInt64LE()
    this.connectionId = crypto.randomBytes(8).readBigUInt64LE()
    this.credentials = Object.freeze([])
    this.signalHandler = null
    this.rtcConnection = null
    this.connection = null
    this.state = 0
  }

  async connect() {
    if (this.state === 1 || this.state === 2) throw new Error('NetherNet is already connecting');
    this.state = 1

    try {
      await this.createOffer()
    } catch (error) {
      this.close()
      this.emit('fault', error)

      throw error
    }
  }

  async createOffer() {
    const peer = this.rtcConnection = new RTCPeerConnection({
      iceServers: this.getIceServers(),
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    })

    const connection = this.connection = new Connection(this, peer)
    connection.setChannels(
      peer.createDataChannel('ReliableDataChannel', { ordered: true }),
      peer.createDataChannel('UnreliableDataChannel', { ordered: false, maxRetransmits: 0 })
    )

    peer.onicecandidate = ({ candidate }) => {
      if (this.state === 4) return;

      const value = candidate?.candidate
      if (!value || value.includes(' tcp ') || value.includes(' 127.0.0.1 ') || value.includes(' ::1 ')) return;

      try {
        this.sendSignal(new SignalStructure('CANDIDATEADD', this.connectionId, value, this.networkId, this.serverNetworkId))
      } catch (error) {
        this.emit('fault', error)
      }
    }

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState

      if (state === 'connected') {
        if (this.state !== 2) {
          this.state = 2
          this.emit('connected', connection)
        }
      } else if ((state === 'failed' || state === 'closed') && this.state !== 4) {
        this.state = 4
        this.emit('disconnect', this.connectionId, state)
      }
    }

    const offer = await peer.createOffer()
    const sdp = this.addIdentity(offer.sdp || '')
    await peer.setLocalDescription({ type: 'offer', sdp })

    if (this.state !== 4) {
      this.sendSignal(new SignalStructure('CONNECTREQUEST', this.connectionId, sdp, this.networkId, this.serverNetworkId))
    }
  }

  getIceServers() {
    const credentials = this.credentials
    if (!credentials?.length) return Object.freeze([])

    return credentials.map(server => {
      if (server.urls || server.url) return server

      const urls = server.Urls ?? server.Uri ?? server.uri
      if (!urls) return null

      return {
        urls: Array.isArray(urls) ? urls : [urls],
        username: server.Username ?? server.username,
        credential: server.Password
      }
    }).filter(Boolean)
  }

  addIdentity(sdp) {
    const privateKey = this.ecdhKeyPair?.privateKey
    if (!this.token || !privateKey) return sdp

    const fingerprint = sdp.match(/^a=fingerprint:sha-256\s+(.+)$/m)?.[1]
    if (!fingerprint) return sdp

    const header = Buffer.from('{"alg":"ES384"}').toString('base64url')
    const payload = Buffer.from(JSON.stringify({ fingerprint: [{ algorithm: 'sha-256', digest: fingerprint }] })).toString('base64url')
    const signature = crypto.sign('sha384', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')

    const assertion = Buffer.from(JSON.stringify({
      assertion: JSON.stringify({ fingerprints: `${header}..${signature}`, token: this.token }),
      idp: { domain: 'https://authorization.franchise.minecraft-services.net/', protocol: 'default' }
    })).toString('base64')

    return sdp.replace(/^a=fingerprint:sha-256\s+.*$/m, line => `${line}\na=identity:${assertion}`)
  }

  async handleSignal(signal) {
    if (this.state === 4 || !signal || String(signal.connectionId) !== String(this.connectionId)) return

    const peer = this.rtcConnection
    switch (signal.type) {
      case 'CONNECTRESPONSE': {
        if (!peer || peer.signalingState === 'closed' || peer.signalingState === 'stable') return

        try {
          await peer.setRemoteDescription({ type: 'answer', sdp: String(signal.data).replace(/^a=identity:.*(?:\r?\n|$)/gm, '') })
        } catch (error) {
          this.emit('fault', error)
        }

        break
      }

      case 'CANDIDATEADD': {
        if (!peer) return;
        const candidate = typeof signal.data === 'string' ? { candidate: signal.data } : signal.data
        if (!candidate?.candidate) return;

        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (error) {
          this.emit('fault', error)
        }

        break;
      }

      case 'CONNECTERROR':
        this.emit('disconnect', this.connectionId, signal.data || 'connect error')
        break;
    }
  }

  sendSignal(signal) {
    if (typeof this.signalHandler !== 'function') throw new Error('NetherNet signal handler is not configured')
    return this.signalHandler(signal)
  }

  send(buffer) {
    if (!this.connection) throw new Error('NetherNet connection is not initialized')
    return this.connection.send(buffer)
  }

  close() {
    if (this.state === 4) return;
    this.state = 4

    const connection = this.connection
    const peer = this.rtcConnection

    this.connection = null
    this.rtcConnection = null
    this.signalHandler = null

    try { connection?.close() } catch {}
    try { peer?.close() } catch {}

    this.removeAllListeners()
  }
}

module.exports = { Client }