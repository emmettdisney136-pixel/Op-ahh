'use strict';

const DiscordJSClient = require('./Classes/DiscordJS/DiscordJSClient');

new DiscordJSClient()
    .start();

const callback = (error, promise = null) => 
    console.log("Error:", error, "Promise ?:", promise);

process.on("uncaughtException", callback);
process.on("unhandledRejection", callback);