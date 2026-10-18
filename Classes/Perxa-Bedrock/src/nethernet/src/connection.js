const asBuffer = data => {
  if (Buffer.isBuffer(data)) return data
  if (typeof data === 'string') return Buffer.from(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  throw new TypeError('Unsupported RTC message type')
}

class Connection {
  constructor(nethernet, peer) {
    this.nethernet = nethernet
    this.peer = peer
    this.reliable = this.unreliable = null
    this.parts = []
    this.length = 0
    this.remaining = null
    this.queue = []
  }

  setChannels(reliable, unreliable) {
    this.reliable = reliable
    this.unreliable = unreliable

    reliable.onmessage = ({ data }) => this.receive(data);
    reliable.onopen = () => this.flush();
    reliable.onerror = error => this.nethernet?.emit('fault', error instanceof Error ? error : new Error('ReliableDataChannel error'));

    unreliable.onmessage = ({ data }) => {
      try {
        const frame = asBuffer(data)
        if (!frame.length || frame[0]) throw new Error('Invalid unreliable NetherNet frame')

        this.nethernet?.emit('unreliable', frame.subarray(1))
      } catch (error) {
        this.nethernet?.emit('fault', error)
      }
    }

    unreliable.onerror = error => this.nethernet?.emit('fault', error instanceof Error ? error : new Error('UnreliableDataChannel error'))
  }

  receive(data) {
    try {
      const frame = asBuffer(data)
      if (!frame.length) throw new Error('Invalid NetherNet frame')

      const remaining = frame[0]
      if (this.remaining !== null && remaining !== this.remaining - 1) throw new Error('Invalid NetherNet fragment sequence');

      const payload = frame.subarray(1);
      this.parts.push(payload);
      this.length += payload.length
      this.remaining = remaining

      if (remaining) return;
      const message = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.length)

      this.parts = []
      this.length = 0
      this.remaining = null

      this.nethernet?.emit('encapsulated', message);
    } catch (error) {
      this.parts = []
      this.length = 0
      this.remaining = null
      this.nethernet?.emit('fault', error);
    }
  }

  send(data) {
    const payload = asBuffer(data);
    const reliable = this.reliable;

    if (!reliable || reliable.readyState === 'connecting') {
      this.queue.push(payload);

      return payload.length;
    }

    if (reliable.readyState !== 'open') return;

    this.sendReliable(payload);
    return payload.length;
  }

  sendUnreliable(data) {
    const payload = asBuffer(data);
    const unreliable = this.unreliable;

    if (payload.length > 50000) throw new RangeError('Unreliable NetherNet messages cannot be fragmented');

    const frame = Buffer.allocUnsafe(payload.length + 1);
    frame[0] = 0;
    payload.copy(frame, 1);

    unreliable.send(frame);
    return payload.length;
  }

  sendReliable(payload) {
    const count = Math.ceil(payload.length / 50000) || 1;
    if (count > 256) throw new RangeError('NetherNet message requires more than 256 fragments');

    for (let i = 0, offset = 0; i < count; i++) {
      const length = Math.min(50000, payload.length - offset);
      const frame = Buffer.allocUnsafe(length + 1);

      frame[0] = count - i - 1;
      payload.copy(frame, 1, offset, offset + length);

      offset += length;
      this.reliable.send(frame);
    }
  }

  flush() {
    const queue = this.queue
    this.queue = []
    for (let i = 0; i < queue.length; i++) this.sendReliable(queue[i]);
  }

  close() {
    const reliable = this.reliable
    const unreliable = this.unreliable

    this.queue.length = 0
    this.parts.length = 0
    this.length = 0
    this.remaining = null

    this.reliable = null
    this.unreliable = null
    this.peer = null
    this.nethernet = null

    if (reliable) {
      reliable.onmessage = null
      reliable.onopen = null
      reliable.onerror = null
      reliable.onclose = null
      try { reliable.close() } catch { }
    }

    if (unreliable) {
      unreliable.onmessage = null
      unreliable.onopen = null
      unreliable.onerror = null
      unreliable.onclose = null
      try { unreliable.close() } catch { }
    }
  }
}

module.exports = { Connection }