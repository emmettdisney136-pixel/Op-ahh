'use strict'

const Endpoints = {
  live: {
    deviceCode: 'https://login.live.com/oauth20_connect.srf',
    token: 'https://login.live.com/oauth20_token.srf'
  },

xbox: {
  userAuth: 'https://user.auth.xboxlive.com/user/authenticate',
  deviceAuth: 'https://device.auth.xboxlive.com/device/authenticate',
  titleAuth: 'https://title.auth.xboxlive.com/title/authenticate',
  sisuAuthorize: 'https://sisu.xboxlive.com/authorize',
  xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  authRelyingParty: 'http://auth.xboxlive.com',
  relyingParty: 'http://xboxlive.com'
},

  playfab: {
    loginWithXbox: 'https://20ca2.playfabapi.com/Client/LoginWithXbox',
    relyingParty: 'https://b980a380.minecraft.playfabapi.com/'
  },

  minecraft: {
    bedrock: {
      relyingParty: 'https://multiplayer.minecraft.net/',
      authenticate: 'https://multiplayer.minecraft.net/authentication',
      services: 'https://authorization.franchise.minecraft-services.net/api/v1.0/session/start',
      multiplayer: 'https://authorization.franchise.minecraft-services.net/api/v1.0/multiplayer/session/start'
    }
  }
}

const Titles = {
  MinecraftNintendoSwitch: '00000000441cc96b',
  MinecraftPlaystation: '000000004827c78e',
  MinecraftAndroid: '0000000048183522',
  MinecraftJava: '00000000402b5328',
  MinecraftIOS: '000000004c17c01a',
  XboxAppIOS: '000000004c12ae6f',
  XboxGamepassIOS: '000000004c20a908'
}

module.exports = { Endpoints, Titles }