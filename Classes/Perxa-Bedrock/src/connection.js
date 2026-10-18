
const { EventEmitter } = require('events')
const { Framer } = require('./transforms/framer')

const { types: { varint: [readVarInt, writeVarInt, sizeOfVarInt] } } = require('protodef')

function setPacketSubClients(packet, senderSubID = 0, targetSubID = 0) {
  if (senderSubID < 0 || senderSubID > 3 || !Number.isInteger(senderSubID) || targetSubID < 0 || targetSubID > 3 || !Number.isInteger(targetSubID))
    throw new RangeError('Sub-client IDs must be integers from 0 to 3')

  const { value, size } = readVarInt(packet, 0)
  const packetId = value & 0x3ff
  const header = packetId | (senderSubID << 10) | (targetSubID << 12)

  const output = Buffer.allocUnsafe(sizeOfVarInt(header) + packet.length - size)
  const offset = writeVarInt(header, output, 0)

  packet.copy(output, offset, size)
  return output
}

class Connection extends EventEmitter {
  batch = new Framer(this)

  write(name, params, targetSubID = 0, senderSubID = 0, count = 1) {
    if (!this.batch?.addEncodedPacket) return

    try {
      if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer')

      const packet = this.serializer.createPacketBuffer({ name, params })
      const encodedPacket = setPacketSubClients(packet, senderSubID, targetSubID)

      if (count === 1) {
        this.batch.addEncodedPacket(encodedPacket)
      } else {
        this.batch.addEncodedPackets(encodedPacket, count)
      }

      this.sendDecryptedBatch(this.batch)
    } catch (error) {
      console.error(`Failed to write packet "${name}":`, error)
    }
  }

  sendBuffer(buffer) {
    if (!this.batch?.addEncodedPacket) return

    try {
      this.batch.addEncodedPacket(buffer)
      this.sendDecryptedBatch(this.batch)
    } catch (error) {
      console.error('Failed to send buffer:', error)
    }
  }

  sendCustomBatch(batch) {
    this.sendDecryptedBatch(batch)
  }

  sendDecryptedBatch(batch) {
    this.sendMCPE(batch.encode(), true)
  }

  sendEncryptedBatch(batch) {
    this.encrypt(Buffer.concat(batch.packets))
  }

  sendMCPE(buffer, immediate) {
    try {
      this.connection.sendReliable(buffer, immediate)
    } finally {
      this.batch.packets = []
    }
  }

  onEncryptedPacket = (buf) => {
    const packet = this.batchHeader
      ? Buffer.concat([Buffer.from([this.batchHeader]), buf])
      : buf

    this.sendMCPE(packet)
  }

  onDecryptedPacket = (buf) => {
    for (const packet of Framer.getPackets(buf)) {
      this.readPacket(packet)
    }
  }

  handle(buffer) {
    if (this.batchHeader && buffer[0] !== this.batchHeader) {
      throw new Error(`Bad packet header ${buffer[0]}`)
    }

    for (const packet of Framer.decode(this, buffer)) {
      this.readPacket(packet)
    }
  }
}

module.exports = {
  Connection,
  setPacketSubClients
}