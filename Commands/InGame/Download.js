const Command = require("../_/Command.js");
const RealmApi = require("../../Classes/Realm.js");
const Client = require("../../Classes/Client.js");

const fs = require("fs");
const path = require("path");

let LevelDB;
try { ({ LevelDB } = require("leveldb-zlib")); }
catch (e) { console.error("[WorldDownloader] leveldb-zlib required:", e); }

const CFG = {
    radius: 16,
    requestBatchSize: 5,
    captureTimeout: 5 * 60 * 1000,
    idleTimeout: 30 * 1000,
    minSubchunk: -4,
    maxSubchunk: 19,
    subchunkVersion: 9,
    defaultBlockVersion: 18168865,
    maxErrorSamples: 8
};

const AIR_RESULTS = new Set(["success_all_air", "success_empty", "all_air"]);
const MISSING_RESULTS = new Set(["chunk_not_found", "not_found", "missing"]);
const INVALID_RESULTS = new Set(["invalid_dimension", "player_not_found", "y_index_out_of_bounds", "undefined"]);
const VALID_BITS = new Set([0, 1, 2, 3, 4, 5, 6, 8, 16]);

const mkdir = d => fs.mkdirSync(d, { recursive: true });
const safeName = v => String(v).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
const nowId = () => new Date().toISOString().replace(/[:.]/g, "-");
const writeBuffer = (f, b) => { mkdir(path.dirname(f)); fs.writeFileSync(f, b); };
const writeJson = (f, v) => { mkdir(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

const ab = n => Buffer.allocUnsafe(n);
const i32 = v => { const o = ab(4); o.writeInt32LE(Number(v), 0); return o; };
const i64 = v => {
    const o = ab(8);
    let x = BigInt(v);
    const mod = 1n << 64n;
    x = ((x % mod) + mod) % mod;
    if (x >= (1n << 63n)) x -= mod;
    o.writeBigInt64LE(x, 0);
    return o;
};
const u16 = v => { const o = ab(2); o.writeUInt16LE(Number(v), 0); return o; };
const f32 = v => { const o = ab(4); o.writeFloatLE(Number(v), 0); return o; };

// NBT
const nbtName = n => { const v = Buffer.from(String(n), "utf8"); return Buffer.concat([u16(v.length), v]); };
const nbtByte = (n, v) => Buffer.concat([Buffer.from([1]), nbtName(n), Buffer.from([Number(v) & 255])]);
const nbtInt = (n, v) => Buffer.concat([Buffer.from([3]), nbtName(n), i32(v)]);
const nbtLong = (n, v) => Buffer.concat([Buffer.from([4]), nbtName(n), i64(v)]);
const nbtFloat = (n, v) => Buffer.concat([Buffer.from([5]), nbtName(n), f32(v)]);
const nbtString = (n, v) => {
    const d = Buffer.from(String(v), "utf8");
    return Buffer.concat([Buffer.from([8]), nbtName(n), u16(d.length), d]);
};
const nbtCompound = (n, c) => Buffer.concat([Buffer.from([10]), nbtName(n), ...c, Buffer.from([0])]);

function nbtValue(name, value) {
    if (typeof value === "boolean") return nbtByte(name, value ? 1 : 0);
    if (typeof value === "bigint") return nbtLong(name, value);
    if (typeof value === "number") return Number.isInteger(value) ? nbtInt(name, value) : nbtFloat(name, value);
    if (typeof value === "string") return nbtString(name, value);
    if (Array.isArray(value)) {
        if (!value.length) return Buffer.concat([Buffer.from([9]), nbtName(name), Buffer.from([3]), i32(0)]);
        if (value.every(x => typeof x === "number" || typeof x === "boolean"))
            return Buffer.concat([Buffer.from([9]), nbtName(name), Buffer.from([3]), i32(value.length), ...value.map(x => i32(Number(x)))]);
        if (value.every(x => typeof x === "string"))
            return Buffer.concat([Buffer.from([9]), nbtName(name), Buffer.from([8]), i32(value.length),
                ...value.map(x => { const d = Buffer.from(x, "utf8"); return Buffer.concat([u16(d.length), d]); })]);
        return nbtString(name, JSON.stringify(value));
    }
    if (value && typeof value === "object")
        return nbtCompound(name, Object.entries(value).map(([k, v]) => nbtValue(k, v)));
    return nbtString(name, "");
}

function persistentPaletteEntry(entry) {
    const s = entry || {};
    const name = s.name ?? s.Name ?? "minecraft:air";
    const states = s.states ?? s.States ?? {};
    const version = Number(s.version ?? s.Version ?? CFG.defaultBlockVersion);
    return nbtCompound("", [
        nbtString("name", name),
        nbtCompound("states", Object.entries(states || {}).map(([k, v]) => nbtValue(k, v))),
        nbtInt("version", version)
    ]);
}

// Keys
function chunkKey(x, z, dim, tag) {
    if (Number(dim) === 0) return Buffer.concat([i32(x), i32(z), Buffer.from([tag])]);
    return Buffer.concat([i32(x), i32(z), i32(dim), Buffer.from([tag])]);
}
const subchunkKey = (x, z, dim, y) => Buffer.concat([chunkKey(x, z, dim, 0x2f), Buffer.from([Number(y) & 255])]);
const blockEntityKey = (x, z, dim) => chunkKey(x, z, dim, 0x31);

async function writeChunkMeta(db, x, z, dim) {
    await db.put(chunkKey(x, z, dim, 0x2c), Buffer.from([40]));
    const f = Buffer.allocUnsafe(4);
    f.writeInt32LE(2, 0);
    await db.put(chunkKey(x, z, dim, 0x36), f);
}

// VarInt
function readVarInt(buffer, state) {
    let value = 0, shift = 0;
    for (;;) {
        if (state.offset >= buffer.length)
            throw new Error(`Unexpected end of VarInt at ${state.offset}/${buffer.length}`);
        const byte = buffer[state.offset++];
        value += (byte & 0x7f) * 2 ** shift;
        if (!(byte & 0x80)) return value;
        shift += 7;
        if (shift > 35) throw new Error("Invalid VarInt");
    }
}

// Word counts
const wordsPerWord = bits => Math.ceil(4096 / Math.floor(32 / bits));
const wordsContig = bits => Math.ceil((4096 * bits) / 32);

/**
 * Try to read a palette starting at `offset`.
 * Returns { palette, size, endOffset, leftover } or null.
 */
function tryPaletteAt(buffer, offset, strict) {
    if (offset < 0 || offset >= buffer.length - 1) return null;
    const state = { offset };
    try {
        const size = readVarInt(buffer, state);
        if (size < 1 || size > 512) return null;
        const palette = new Uint32Array(size);
        for (let i = 0; i < size; i++) palette[i] = readVarInt(buffer, state);
        const leftover = buffer.length - state.offset;
        if (leftover < 0) return null;
        if (strict && leftover > 8) return null;
        return { palette, size, endOffset: state.offset, leftover };
    } catch { return null; }
}

/**
 * Read a storage with palette-offset scanning.
 *
 * Standard formula gives an approximate palette position; we scan
 * ±32 bytes around it (and, as a fallback, the tail of the buffer)
 * to find the offset that parses cleanly to the end.
 */
function readStorage(buffer, state, isLast) {
    const headerOffset = state.offset;
    const header = buffer[state.offset++];
    const bits = header >> 1;
    const runtime = !!(header & 1);

    if (!VALID_BITS.has(bits))
        throw new Error(`Invalid bits-per-block ${bits} at ${headerOffset}`);

    if (bits === 0) {
        const id = readVarInt(buffer, state);
        return { bits: 0, runtime, packed: Buffer.alloc(0), palette: new Uint32Array([id]) };
    }

    const dataStart = state.offset;
    const packedSizes = [...new Set([wordsPerWord(bits) * 4, wordsContig(bits) * 4])];

    const candidates = [];
    const deltas = [0, 4, -4, 8, -8, 12, -12, 2, -2, 16, -16, 6, -6, 20, -20, 24, -24, 28, -28, 32, -32];

    for (const packedBytes of packedSizes) {
        const expected = dataStart + packedBytes;
        if (expected > buffer.length) continue;

        for (const delta of deltas) {
            const ps = expected + delta;
            if (ps < dataStart + 4 || ps > buffer.length - 2) continue;

            const hit = tryPaletteAt(buffer, ps, isLast);
            if (!hit) continue;

            candidates.push({
                packedBytes,
                palette: hit.palette,
                paletteSize: hit.size,
                endOffset: hit.endOffset,
                leftover: hit.leftover,
                delta,
                packed: Buffer.from(buffer.subarray(dataStart, dataStart + packedBytes))
            });
        }
    }

    // Broader scan if formula offsets missed.
    if (!candidates.length) {
        const lo = Math.max(dataStart + 4, buffer.length - 260);
        const hi = buffer.length - 2;
        for (let ps = lo; ps <= hi; ps++) {
            const hit = tryPaletteAt(buffer, ps, true);
            if (!hit) continue;
            candidates.push({
                packedBytes: ps - dataStart,
                palette: hit.palette,
                paletteSize: hit.size,
                endOffset: hit.endOffset,
                leftover: hit.leftover,
                delta: 0,
                packed: Buffer.from(buffer.subarray(dataStart, ps))
            });
        }
    }

    if (!candidates.length)
        throw new Error(`No palette for bits=${bits} @${headerOffset} len=${buffer.length}`);

    // Prefer: leftover==0, small |delta|, small palette, larger packed.
    candidates.sort((a, b) => {
        if (a.leftover !== b.leftover) return a.leftover - b.leftover;
        const da = Math.abs(a.delta), db = Math.abs(b.delta);
        if (da !== db) return da - db;
        if (a.paletteSize !== b.paletteSize) return a.paletteSize - b.paletteSize;
        return b.packedBytes - a.packedBytes;
    });

    const best = candidates[0];
    state.offset = best.endOffset;

    return {
        bits: best.bits ?? bits,
        runtime,
        packed: best.packed,
        palette: best.palette
    };
}

function decodeSubchunk(payload) {
    const buffer = payloadToBuffer(payload);
    if (buffer.length < 2) throw new Error(`Truncated len=${buffer.length}`);

    const version = buffer[0];
    if (version !== 8 && version !== 9 && version !== 10)
        throw new Error(`Invalid version ${version}`);

    const storageCount = buffer[1];
    if (storageCount < 1 || storageCount > 32)
        throw new Error(`Invalid storage count ${storageCount}`);

    let offset = 2;
    let yIndex = null;
    if (version >= 9) { yIndex = buffer.readInt8(offset); offset++; }

    const storages = [];
    for (let i = 0; i < storageCount; i++) {
        storages.push(readStorage(buffer, { offset }, i === storageCount - 1));
        offset = storages[i].__next ?? offset;
    }

    // Capture next offset after each storage read.
    // (readStorage updates state.offset; we mirror it.)
    // Re-walk to get final offset.
    let walk = version >= 9 ? 3 : 2;
    for (let i = 0; i < storageCount; i++) {
        const s = { offset: walk };
        readStorage(buffer, s, i === storageCount - 1);
        walk = s.offset;
    }

    return { version, yIndex, storages };
}

function payloadToBuffer(payload) {
    if (Buffer.isBuffer(payload)) return payload;
    if (payload instanceof Uint8Array) return Buffer.from(payload);
    if (Array.isArray(payload)) return Buffer.from(payload);
    if (typeof payload === "string") {
        const clean = payload.replace(/\s+/g, "");
        if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0) return Buffer.from(clean, "hex");
        try { return Buffer.from(clean, "base64"); }
        catch { return Buffer.from(payload, "utf8"); }
    }
    if (payload && typeof payload === "object") {
        for (const k of ["data", "buffer", "payload", "bytes"])
            if (payload[k] !== undefined) return payloadToBuffer(payload[k]);
    }
    return Buffer.from(payload || []);
}

// Palette
function normalizeBlockName(n) {
    const v = String(n || "minecraft:air");
    return v.includes(":") ? v : `minecraft:${v}`;
}
const stateValue = v => (v && typeof v === "object" && "value" in v) ? v.value : v;
function normalizeBlockState(e) {
    if (!e) return null;
    const states = {};
    for (const [k, v] of Object.entries(e.states || {})) states[k] = stateValue(v);
    return { name: normalizeBlockName(e.name), states, version: Number(e.version ?? CFG.defaultBlockVersion) };
}

function buildRuntimePalette(startGame) {
    const props = Array.isArray(startGame?.block_properties) ? startGame.block_properties : [];
    if (!props.length) throw new Error("Server sent no block_properties; cannot resolve palette.");
    return props.map(e => normalizeBlockState({
        name: e?.name,
        states: e?.state?.states ?? e?.state?.States ?? e?.state ?? {},
        version: e?.state?.version ?? e?.state?.Version ?? CFG.defaultBlockVersion
    }) || { name: "minecraft:air", states: {}, version: CFG.defaultBlockVersion });
}

const FALLBACK_BLOCK = { name: "minecraft:stone", states: {}, version: CFG.defaultBlockVersion };
function resolveBlock(palette, id) {
    return palette?.[Number(id)] ?? FALLBACK_BLOCK;
}

function encodeDiskSubchunk(payload, runtimePalette, y) {
    const decoded = decodeSubchunk(payload);
    return {
        y: decoded.yIndex ?? y,
        storages: decoded.storages.map(s => ({
            bits: s.bits,
            packed: s.packed,
            palette: Array.from(s.palette, id => resolveBlock(runtimePalette, id))
        }))
    };
}

function serializeDiskSubchunk(sub) {
    if (!sub?.storages?.length) throw new Error("Empty subchunk");
    const out = [Buffer.from([CFG.subchunkVersion, sub.storages.length, Number(sub.y) & 255])];
    for (const s of sub.storages) {
        const bits = Number(s.bits);
        if (!VALID_BITS.has(bits)) throw new Error(`Invalid disk bits=${bits}`);
        out.push(Buffer.from([bits << 1]));
        if (bits !== 0) {
            const expected = wordsPerWord(bits) * 4;
            let packed = s.packed;
            if (!Buffer.isBuffer(packed) || packed.length !== expected) {
                const buf = Buffer.alloc(expected);
                if (packed && packed.length)
                    packed.copy(buf, 0, 0, Math.min(packed.length, expected));
                packed = buf;
            }
            out.push(packed);
        }
        out.push(i32(s.palette.length));
        for (const e of s.palette) out.push(persistentPaletteEntry(e));
    }
    return Buffer.concat(out);
}

function airSubchunk(runtimePalette, y) {
    const air = runtimePalette?.[0] || { name: "minecraft:air", states: {}, version: CFG.defaultBlockVersion };
    return serializeDiskSubchunk({
        y, storages: [{ bits: 0, packed: Buffer.alloc(0), palette: [air] }]
    });
}

// Serialize / level.dat
function serialize(v, seen = new WeakSet()) {
    if (typeof v === "bigint") return v.toString();
    if (Buffer.isBuffer(v)) return v.toString("base64");
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(x => serialize(x, seen));
    return Object.fromEntries(Object.entries(v).map(([k, c]) => [k, serialize(c, seen)]));
}

function gameMode(v) {
    if (typeof v === "number") return v;
    return { survival: 0, creative: 1, adventure: 2, survival_spectator: 3, creative_spectator: 4, fallback: 5, spectator: 6 }[String(v)] ?? 0;
}

function levelDat(startGame, realm) {
    const pos = startGame?.player_position || {};
    const root = Buffer.concat([
        Buffer.from([10]), u16(0),
        nbtString("LevelName", realm?.name || "Realm Download"),
        nbtInt("StorageVersion", 10),
        nbtInt("NetworkVersion", Number(startGame?.protocol_version || 0)),
        nbtInt("WorldVersion", 1),
        nbtString("InventoryVersion", String(startGame?.engine_version || startGame?.engine || "1.21.60")),
        nbtLong("RandomSeed", startGame?.seed || 0),
        nbtLong("Seed", startGame?.seed || 0),
        nbtInt("Generator", 1),
        nbtInt("GameType", gameMode(startGame?.player_gamemode)),
        nbtInt("Difficulty", Number(startGame?.difficulty ?? 2)),
        nbtInt("SpawnX", Math.floor(Number(pos.x || 0))),
        nbtInt("SpawnY", Math.floor(Number(pos.y ?? 100))),
        nbtInt("SpawnZ", Math.floor(Number(pos.z || 0))),
        nbtInt("SpawnDimension", 0),
        nbtLong("LastPlayed", BigInt(Date.now())),
        nbtLong("Time", BigInt(startGame?.current_tick || 0)),
        nbtByte("commandsEnabled", startGame?.enable_commands || 0),
        nbtByte("hasBeenLoadedInCreative", 1),
        nbtByte("showcoordinates", 1),
        nbtByte("dodaylightcycle", 1),
        nbtByte("doweathercycle", 1),
        nbtByte("domobspawning", 1),
        nbtByte("doentitydrops", 1),
        nbtByte("pvp", 1),
        nbtFloat("rainLevel", 0),
        nbtFloat("lightningLevel", 0),
        nbtInt("rainTime", 0),
        Buffer.from([0])
    ]);
    return Buffer.concat([i32(10), i32(root.length), root]);
}

// Zip
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let v = i; for (let j = 0; j < 8; j++) v = v & 1 ? (v >>> 1) ^ 0xedb88320 : v >>> 1; crcTable[i] = v >>> 0; }
function crc32File(file) {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let position = 0, crc = 0xffffffff, len;
    try { while ((len = fs.readSync(fd, buf, 0, buf.length, position)) > 0) {
        for (let i = 0; i < len; i++) crc = crcTable[(crc ^ buf[i]) & 255] ^ (crc >>> 8);
        position += len;
    } } finally { fs.closeSync(fd); }
    return (crc ^ 0xffffffff) >>> 0;
}
function writeAll(fd, buf) { let o = 0; while (o < buf.length) o += fs.writeSync(fd, buf, o, buf.length - o); }
function collectFiles(dir) {
    const files = [];
    (function walk(cur) {
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
            const abs = path.join(cur, e.name);
            if (e.isDirectory()) walk(abs);
            else files.push({ absolute: abs, relative: path.relative(dir, abs).replace(/\\/g, "/") });
        }
    })(dir);
    return files;
}
function copyFile(fd, file) {
    const inp = fs.openSync(file, "r");
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let position = 0, len;
    try { while ((len = fs.readSync(inp, buf, 0, buf.length, position)) > 0) {
        writeAll(fd, buf.subarray(0, len)); position += len;
    } } finally { fs.closeSync(inp); }
}
function zipStore(dir, out) {
    const files = collectFiles(dir);
    mkdir(path.dirname(out));
    const fd = fs.openSync(out, "w");
    const central = []; let offset = 0;
    try {
        for (const f of files) {
            const stat = fs.statSync(f.absolute);
            if (stat.size > 0xffffffff) throw new Error("File too large");
            const name = Buffer.from(f.relative, "utf8");
            const crc = crc32File(f.absolute);
            const local = Buffer.alloc(30 + name.length); let p = 0;
            local.writeUInt32LE(0x04034b50, p); p += 4;
            local.writeUInt16LE(20, p); p += 2;
            local.writeUInt16LE(0x800, p); p += 2;
            local.writeUInt16LE(0, p); p += 2;
            local.writeUInt16LE(0, p); p += 2;
            local.writeUInt16LE(0, p); p += 2;
            local.writeUInt32LE(crc, p); p += 4;
            local.writeUInt32LE(stat.size, p); p += 4;
            local.writeUInt32LE(stat.size, p); p += 4;
            local.writeUInt16LE(name.length, p); p += 2;
            local.writeUInt16LE(0, p); p += 2;
            name.copy(local, p);
            writeAll(fd, local); copyFile(fd, f.absolute);
            const h = Buffer.alloc(46 + name.length); p = 0;
            h.writeUInt32LE(0x02014b50, p); p += 4;
            h.writeUInt16LE(20, p); p += 2;
            h.writeUInt16LE(20, p); p += 2;
            h.writeUInt16LE(0x800, p); p += 2;
            h.writeUInt16LE(0, p); p += 2;
            h.writeUInt16LE(0, p); p += 2;
            h.writeUInt16LE(0, p); p += 2;
            h.writeUInt32LE(crc, p); p += 4;
            h.writeUInt32LE(stat.size, p); p += 4;
            h.writeUInt32LE(stat.size, p); p += 4;
            h.writeUInt16LE(name.length, p); p += 2;
            h.writeUInt16LE(0, p); p += 2;
            h.writeUInt16LE(0, p); p += 2;
            h.writeUInt16LE(0, p); p += 2;
            h.writeUInt16LE(0, p); p += 2;
            h.writeUInt32LE(0, p); p += 4;
            h.writeUInt32LE(offset, p); p += 4;
            name.copy(h, p);
            central.push(h); offset += 30 + name.length + stat.size;
        }
        const cOff = offset;
        for (const h of central) { writeAll(fd, h); offset += h.length; }
        const cSize = offset - cOff;
        const end = Buffer.alloc(22); let p = 0;
        end.writeUInt32LE(0x06054b50, p); p += 4;
        end.writeUInt16LE(0, p); p += 2;
        end.writeUInt16LE(0, p); p += 2;
        end.writeUInt16LE(files.length, p); p += 2;
        end.writeUInt16LE(files.length, p); p += 2;
        end.writeUInt32LE(cSize, p); p += 4;
        end.writeUInt32LE(cOff, p); p += 4;
        end.writeUInt16LE(0, p);
        writeAll(fd, end);
    } finally { fs.closeSync(fd); }
}

function packetWriter(client) {
    for (const t of [client, client?.client, client?.connection, client?.conn, client?.bot, client?.protocol]) {
        if (!t) continue;
        if (typeof t.write === "function") return t.write.bind(t);
        if (typeof t.queue === "function") return t.queue.bind(t);
    }
    return null;
}

function encodeBlockEntity(nbt) {
    if (Buffer.isBuffer(nbt)) return nbt;
    if (!nbt || typeof nbt !== "object") return null;
    return nbtCompound("", Object.entries(nbt).map(([k, v]) => nbtValue(k, v)));
}

// Downloader
class WorldDownloader {
    constructor(root, realm) {
        this.root = root;
        this.realm = realm;
        this.db = null;
        this.client = null;
        this.startGame = null;
        this.runtimePalette = [];
        this.chunks = new Set();
        this.subchunks = new Set();
        this.pending = new Set();
        this.blockEntities = new Map();
        this.requested = new Map();
        this.received = new Map();
        this.missing = new Map();
        this.subchunkErrors = 0;
        this.subchunkErrorSamples = [];
        this.packetCount = 0;
        this.successCount = 0;
        this.airCount = 0;
        this.missingCount = 0;
        this.payloadBytes = 0;
        this.writeCount = 0;
        this.armIdle = null;
    }

    async open() {
        if (!LevelDB) throw new Error("leveldb-zlib required");
        if (this.db) return;
        mkdir(this.root);
        this.db = new LevelDB(path.join(this.root, "db"), { createIfMissing: true });
        await this.db.open();
    }

    handleStartGame(packet) {
        this.startGame = packet;
        this.runtimePalette = buildRuntimePalette(packet);
        console.log(`[WorldDownloader] Runtime palette: ${this.runtimePalette.length} entries`);
        console.log(`[WorldDownloader] Engine: ${packet?.engine_version || packet?.engine || "unknown"}`);
    }

    registerChunk(x, z, dim, count) {
        const k = `${dim}:${x}:${z}`;
        this.requested.set(k, Number(count));
        this.received.set(k, 0);
        this.missing.set(k, 0);
    }

    markReceived(x, z, dim, missing) {
        const k = `${dim}:${x}:${z}`;
        const v = (this.received.get(k) || 0) + 1;
        this.received.set(k, v);
        if (missing) this.missing.set(k, (this.missing.get(k) || 0) + 1);
        return v >= (this.requested.get(k) || 0);
    }

    error(x, y, z, dim, err, payload) {
        this.subchunkErrors++;
        const buf = payloadToBuffer(payload);
        const msg = String(err?.message ?? err);
        if (this.subchunkErrorSamples.length < CFG.maxErrorSamples) {
            this.subchunkErrorSamples.push({
                x, y, z, dim, message: msg, length: buf.length,
                hex: buf.subarray(0, 128).toString("hex")
            });
            console.error(`[WorldDownloader] ERR ${dim}:${x}:${y}:${z}: ${msg}`);
        }
    }

    track(task) { this.pending.add(task); return task.finally(() => this.pending.delete(task)); }

    async writeSubchunk(x, y, z, dim, payload) {
        if (!this.db) return false;
        const key = `${dim}:${x}:${y}:${z}`;
        if (this.subchunks.has(key)) return false;
        const buffer = payloadToBuffer(payload);
        if (!buffer.length) throw new Error(`Empty payload`);

        return this.track((async () => {
            let disk;
            try {
                disk = serializeDiskSubchunk(encodeDiskSubchunk(buffer, this.runtimePalette, y));
            } catch (err) {
                this.error(x, y, z, dim, err, buffer);
                return false;
            }
            await this.db.put(subchunkKey(x, z, dim, y), disk);
            this.subchunks.add(key);
            this.writeCount++;
            return true;
        })());
    }

    async writeAir(x, y, z, dim) {
        if (!this.db) return false;
        const key = `${dim}:${x}:${y}:${z}`;
        if (this.subchunks.has(key)) return false;
        return this.track((async () => {
            await this.db.put(subchunkKey(x, z, dim, y), airSubchunk(this.runtimePalette, y));
            this.subchunks.add(key);
            this.airCount++;
            return true;
        })());
    }

    writeBlockEntity(packet) {
        const p = packet?.position;
        if (!p) return;
        const x = Number(p.x ?? 0), y = Number(p.y ?? 0), z = Number(p.z ?? 0);
        const nbt = encodeBlockEntity(packet?.nbt);
        if (!nbt) return;
        const dim = Number(packet?.dimension ?? 0);
        this.blockEntities.set(`${dim}:${x}:${y}:${z}`, {
            x: Math.floor(x / 16), z: Math.floor(z / 16), dim, nbt
        });
    }

    async flushBlockEntities() {
        if (!this.db || !this.blockEntities.size) return;
        const chunks = new Map();
        for (const e of this.blockEntities.values()) {
            const k = `${e.dim}:${e.x}:${e.z}`;
            if (!chunks.has(k)) chunks.set(k, []);
            chunks.get(k).push(e.nbt);
        }
        for (const [k, values] of chunks) {
            const [dim, x, z] = k.split(":").map(Number);
            await this.db.put(blockEntityKey(x, z, dim), Buffer.concat(values));
        }
    }

    async finalizeChunks() {
        if (!this.db) return;
        for (const [k, expected] of this.requested) {
            const received = this.received.get(k) || 0;
            const missing = this.missing.get(k) || 0;
            if (received < expected) continue;
            if (missing > 0) continue;
            const [dim, x, z] = k.split(":").map(Number);
            await writeChunkMeta(this.db, x, z, dim);
            this.chunks.add(k);
        }
    }

    async build() {
        await this.open();
        try {
            if (this.pending.size) await Promise.allSettled([...this.pending]);
            await this.finalizeChunks();
            await this.flushBlockEntities();
            writeBuffer(path.join(this.root, "level.dat"), levelDat(this.startGame, this.realm));
            writeJson(path.join(this.root, "world.json"), {
                realm: serialize(this.realm),
                engine: this.startGame?.engine_version ?? null,
                protocolVersion: this.startGame?.protocol_version ?? null,
                chunks: this.chunks.size,
                requestedChunks: this.requested.size,
                subchunks: this.subchunks.size,
                blockEntities: this.blockEntities.size,
                subchunkErrors: this.subchunkErrors,
                missingSubchunks: this.missingCount,
                errorSamples: this.subchunkErrorSamples
            });
            return {
                chunks: this.chunks.size,
                requestedChunks: this.requested.size,
                subchunks: this.subchunks.size,
                blockEntities: this.blockEntities.size,
                subchunkErrors: this.subchunkErrors,
                missingSubchunks: this.missingCount,
                packets: this.packetCount,
                successfulPayloads: this.successCount,
                explicitAir: this.airCount,
                payloadBytes: this.payloadBytes,
                writes: this.writeCount
            };
        } finally { await this.close(); }
    }

    async close() {
        if (this.pending.size) await Promise.allSettled([...this.pending]);
        if (this.db) { await this.db.close(); this.db = null; }
    }
}

class Coords extends Command {
    linkOnly = true;
    constructor() {
        super("meow", "Download the Realm world.", require("../../Data/InputBlock.json"));
    }

    async execute(interaction, { components, args }) {
        const { input } = args;
        Object.assign(this, { interaction, components });
        await interaction.deferReply({ flags: this.flags });

        const existing = this.maps.inGame.get(interaction.user.id);
        if (existing && !existing.disconnect)
            return this.fastReply("Already in game.", "You are already doing an in-game command, please wait for it to finish.");

        this.maps.inGame.set(interaction.user.id, {
            type: "worldDownload", input, stage: "connecting", client: null, disconnect: false
        });

        let client = null, downloader = null, timer = null, idleTimer = null;
        let finished = false, replied = false;

        const clearTimers = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        };

        const failReply = async err => {
            if (replied) return;
            replied = true;
            return this.fastReply("World Download Failed.", `\`\`\`\n${err?.stack ?? err}\n\`\`\``, true);
        };

        const finish = async reason => {
            if (finished) return null;
            finished = true;
            clearTimers();
            try {
                try { client?.destroyClient("World download finished.", "connectionVoided"); } catch {}
                const result = await downloader.build();
                const worldName = `${safeName(downloader.realm?.name ?? input)}_${Date.now()}`;
                const output = path.join(process.cwd(), "world-captures", `${worldName}.mcworld`);
                zipStore(downloader.root, output);
                this.maps.inGame.delete(interaction.user.id);
                return { result, mcworld: output, reason };
            } catch (err) {
                this.maps.inGame.delete(interaction.user.id);
                throw err;
            }
        };

        const successReply = async result => {
            if (replied) return;
            replied = true;
            const s = result.result;
            const errLine = s.subchunkErrors ? `\n### Subchunk Errors\n### -# > **${s.subchunkErrors}**` : "";
            return this.fastReply(
                "World Downloaded.",
                `Downloaded the Realm world data from ***${downloader.realm?.name ?? input}***.\n\n` +
                `### Chunks\n### -# > **${s.chunks}**\n\n` +
                `### Subchunks\n### -# > **${s.subchunks}**\n\n` +
                `### Block Entities\n### -# > **${s.blockEntities}**\n\n` +
                `### File\n### -# > \`${result.mcworld}\`${errLine}`,
                false
            );
        };

        try {
            const realmApi = new RealmApi(interaction.dbUser);
            await realmApi.init();

            let realm = /^\d+$/.test(input)
                ? await realmApi.getRealmInfoByID(input)
                : await realmApi.getRealmInfo(input, false);
            let host = await realmApi.getRealmIP(realm?.body?.id ?? realm?.id);
            const checked = await realmApi.doRealmChecks(realm, host);

            if (checked?.errorMsg) {
                this.maps.inGame.delete(interaction.user.id);
                return this.fastReply("API Failed.", `Failed to fetch the Realm details.\n### -# > **${checked.errorMsg}**`, true);
            }
            ({ realm, host } = checked);
            realm.address = host.address;

            const realmId = realm?.id ?? realm?.body?.id ?? input;
            const root = path.join(process.cwd(), "world-captures", String(realmId), `${safeName(realm?.name ?? input)}_${nowId()}`);

            downloader = new WorldDownloader(root, realm);
            await downloader.open();

            client = new Client(realmApi, realm, interaction.dbUser, { noRCR: true });
            downloader.client = client;
            this.maps.inGame.get(interaction.user.id).client = client;

            const write = packetWriter(client);
            if (!write) throw new Error("Unable to find packet writer");

            const armIdle = () => {
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(async () => {
                    if (finished || replied) return;
                    try {
                        const r = await finish("idle");
                        if (r) await successReply(r);
                    } catch (err) { await failReply(err); }
                }, CFG.idleTimeout);
            };
            downloader.armIdle = armIdle;

            let requestsSent = false;
            const sendRequests = () => {
                if (requestsSent || finished) return;
                requestsSent = true;

                const start = downloader.startGame;
                if (!start) throw new Error("No start_game yet");

                const pos = start?.player_position || {};
                const centerX = Math.floor(Number(pos.x || 0) / 16);
                const centerZ = Math.floor(Number(pos.z || 0) / 16);
                const minX = centerX - CFG.radius, maxX = centerX + CFG.radius;
                const minZ = centerZ - CFG.radius, maxZ = centerZ + CFG.radius;

                const yR = [];
                for (let y = CFG.minSubchunk; y <= CFG.maxSubchunk; y++) yR.push(y);

                let sentPackets = 0, registered = 0;

                for (let bx = minX; bx <= maxX; bx += CFG.requestBatchSize) {
                    const bmx = Math.min(maxX, bx + CFG.requestBatchSize - 1);
                    for (let bz = minZ; bz <= maxZ; bz += CFG.requestBatchSize) {
                        const bmz = Math.min(maxZ, bz + CFG.requestBatchSize - 1);
                        const requests = [];
                        for (let cx = bx; cx <= bmx; cx++) {
                            for (let cz = bz; cz <= bmz; cz++) {
                                const dx = cx - centerX, dz = cz - centerZ;
                                downloader.registerChunk(cx, cz, 0, yR.length);
                                registered++;
                                for (const y of yR) requests.push({ x: dx, y, z: dz });
                            }
                        }
                        write("subchunk_request", {
                            dimension: 0,
                            origin: { x: centerX, y: 0, z: centerZ },
                            requests
                        });
                        sentPackets++;
                    }
                }

                console.log(`[WorldDownloader] Center=${centerX},${centerZ} chunks=${registered} packets=${sentPackets}`);
                armIdle();
            };

            client.once("start_game", packet => {
                try {
                    downloader.handleStartGame(packet);
                    setTimeout(sendRequests, 1500);
                } catch (err) {
                    console.error("[WorldDownloader] start_game failed:", err);
                    failReply(err).catch(() => {});
                }
            });

            client.on("play_status", p => { if (p?.status === "player_spawn") sendRequests(); });

            client.on("subchunk", async packet => {
                if (!packet || finished) return;
                downloader.packetCount++;
                if (idleTimer) clearTimeout(idleTimer);

                const o = packet.origin || {};
                const ox = Number(o.x ?? packet.x ?? 0);
                const oy = Number(o.y ?? 0);
                const oz = Number(o.z ?? packet.z ?? 0);
                const dim = Number(packet.dimension ?? 0);
                const entries = Array.isArray(packet.entries) ? packet.entries : [];

                for (const entry of entries) {
                    if (!entry) continue;
                    const relative = entry.dx !== undefined || entry.dy !== undefined || entry.dz !== undefined;
                    const x = relative ? ox + Number(entry.dx ?? 0) : Number(entry.x ?? ox);
                    const y = relative ? oy + Number(entry.dy ?? 0) : Number(entry.y ?? oy);
                    const z = relative ? oz + Number(entry.dz ?? 0) : Number(entry.z ?? oz);
                    const result = String(entry.result ?? "");

                    if (MISSING_RESULTS.has(result)) { downloader.missingCount++; downloader.markReceived(x, z, dim, true); continue; }
                    if (INVALID_RESULTS.has(result)) { downloader.error(x, y, z, dim, new Error(`result=${result}`), entry.payload); downloader.markReceived(x, z, dim, true); continue; }
                    if (AIR_RESULTS.has(result)) { await downloader.writeAir(x, y, z, dim); downloader.markReceived(x, z, dim, false); continue; }
                    if (result !== "success") { downloader.error(x, y, z, dim, new Error(`unknown result=${result}`), entry.payload); downloader.markReceived(x, z, dim, true); continue; }

                    const payload = payloadToBuffer(entry.payload);
                    if (!payload.length) { downloader.error(x, y, z, dim, new Error("empty payload"), payload); downloader.markReceived(x, z, dim, true); continue; }

                    downloader.successCount++;
                    downloader.payloadBytes += payload.length;
                    try { await downloader.writeSubchunk(x, y, z, dim, payload); }
                    catch (err) { downloader.error(x, y, z, dim, err, payload); }
                    downloader.markReceived(x, z, dim, false);
                }
                armIdle();
            });

            client.on("block_entity_data", p => {
                try { downloader.writeBlockEntity(p); }
                catch (e) { console.error("[WorldDownloader] block entity failed:", e); }
            });

            client.once("clientClosed", async () => {
                if (finished || replied) return;
                try {
                    const r = await finish("clientClosed");
                    if (r) await successReply(r);
                } catch (err) { await failReply(err); }
            });

            timer = setTimeout(async () => {
                if (finished || replied) return;
                try {
                    const r = await finish("timeout");
                    if (r) await successReply(r);
                } catch (err) { await failReply(err); }
            }, CFG.captureTimeout);

        } catch (err) {
            clearTimers();
            try { client?.destroyClient("World download failed.", "connectionVoided"); } catch {}
            try { await downloader?.close(); } catch {}
            this.maps.inGame.delete(interaction.user.id);
            console.error("[WorldDownloader] fatal:", err);
            return failReply(err);
        }
    }
}

module.exports = Coords;