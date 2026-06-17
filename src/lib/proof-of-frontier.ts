export type ChunkStatus = "locked" | "candidate" | "unlocked";

export interface Chunk {
  x: number;
  y: number;
  status: ChunkStatus;
  key?: string;
  minedBy?: string;
  nonce?: number;
  powHash?: string;
  unlockedAt?: number;
}

export interface NeighborKeys {
  north: string | "EMPTY";
  east: string | "EMPTY";
  south: string | "EMPTY";
  west: string | "EMPTY";
}

export interface WorldState {
  worldSeed: string;
  minerAddress: string;
  chunks: Record<string, Chunk>;
  selectedChunk?: { x: number; y: number };
  difficultyTarget: string;
  epoch: number;
  frontierRoot: string;
  contourSeed: string;
  seedMaxBytes: number;
  blockTargetSeconds: number;
  retargetInterval: number;
  noBlockRelaxSeconds: number;
  unlockedCount: number;
  perimeter: number;
}

export interface PowInput {
  worldSeed: string;
  x: number;
  y: number;
  neighborContext: string;
  minerAddress: string;
  nonce: number;
}

export interface ChunkKeyInput {
  powHash: string;
  neighborContext: string;
  x: number;
  y: number;
  minerAddress: string;
}

export interface UnlockProof {
  nonce: number;
  powHash: string;
  chunkKey: string;
}

export interface WorldMetrics {
  frontierEdges: string[];
  frontierRoot: string;
  contourSeed: string;
  contourSeedBytes: number;
  contourSeedMaxBytes: number;
  contourSeedAttempts: number;
  contourSeedWithinLimit: boolean;
  rawSeedBytes: number;
  unlockedCount: number;
  candidateCount: number;
  perimeter: number;
  displayedDifficulty: number;
}

export type SeedEncodingType = "RAW_EDGES" | "PATH_RLE" | "RECT" | "UNION";

export interface SeedCandidate {
  seed: string;
  encodingType: SeedEncodingType;
  byteLength: number;
  decodedRoot: string;
  isRootValid: boolean;
  isLengthValid: boolean;
  isCanonical: boolean;
  isValid: boolean;
  status: "idle" | "searching" | "valid" | "too_long" | "root_mismatch" | "non_canonical";
}

export interface DifficultyState {
  maxSeedBytes: number;
  minSeedBytes: number;
  rawSeedBytes: number;
  targetBlockIntervalMs: number;
  retargetIntervalMs: number;
  lastRetargetAt: number;
  lastBlockAt: number | null;
  blocksInLastMinute: number;
  stuckMinutes: number;
  status: "hardening" | "stable" | "relaxing" | "guaranteed_solvable";
}

export const EMPTY_KEY = "EMPTY";
export const WORLD_SEED = "share-the-world";
export const MINER_ADDRESS = "NCK_MINER_DEMO_001";
export const CONTOUR_SEED_MAX_BYTES = 128;
export const CONTOUR_SEED_INITIAL_TARGET_BYTES = 24;
export const CONTOUR_SEED_SEARCH_ATTEMPTS = 384;
export const BLOCK_TARGET_SECONDS = 60;
export const DIFFICULTY_RETARGET_INTERVAL = 10;
export const NO_BLOCK_RELAX_SECONDS = 600;
export const SHAPE_SEED_VERSION = "NSS1";

const directionOffsets = {
  north: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: -1 },
  west: { x: -1, y: 0 },
} as const;

export function chunkId(x: number, y: number) {
  return `${x},${y}`;
}

export function parseChunkId(id: string) {
  const [x, y] = id.split(",").map((value) => Number(value));
  return { x, y };
}

export function getNeighborCoords(x: number, y: number) {
  return {
    north: { x, y: y + 1 },
    east: { x: x + 1, y },
    south: { x, y: y - 1 },
    west: { x: x - 1, y },
  };
}

export function isUnlocked(x: number, y: number, chunks: Record<string, Chunk>) {
  return chunks[chunkId(x, y)]?.status === "unlocked";
}

export function getChunkKey(x: number, y: number, chunks: Record<string, Chunk>) {
  const chunk = chunks[chunkId(x, y)];
  return chunk?.status === "unlocked" ? chunk.key : undefined;
}

export function getNeighborKeys(x: number, y: number, chunks: Record<string, Chunk>): NeighborKeys {
  return {
    north: getChunkKey(x, y + 1, chunks) || EMPTY_KEY,
    east: getChunkKey(x + 1, y, chunks) || EMPTY_KEY,
    south: getChunkKey(x, y - 1, chunks) || EMPTY_KEY,
    west: getChunkKey(x - 1, y, chunks) || EMPTY_KEY,
  };
}

export function getUnlockedNeighbors(x: number, y: number, chunks: Record<string, Chunk>) {
  return Object.entries(getNeighborCoords(x, y))
    .filter(([, coord]) => isUnlocked(coord.x, coord.y, chunks))
    .map(([direction, coord]) => ({ direction, ...coord, key: getChunkKey(coord.x, coord.y, chunks) || EMPTY_KEY }));
}

export function isCandidate(x: number, y: number, chunks: Record<string, Chunk>) {
  if (isUnlocked(x, y, chunks)) return false;
  return getUnlockedNeighbors(x, y, chunks).length >= 1;
}

export function computeCandidates(chunks: Record<string, Chunk>) {
  const candidates: Record<string, Chunk> = {};
  Object.values(chunks)
    .filter((chunk) => chunk.status === "unlocked")
    .forEach((chunk) => {
      Object.values(getNeighborCoords(chunk.x, chunk.y)).forEach((coord) => {
        const id = chunkId(coord.x, coord.y);
        if (!chunks[id] && isCandidate(coord.x, coord.y, chunks)) {
          candidates[id] = { x: coord.x, y: coord.y, status: "candidate" };
        }
      });
    });
  return candidates;
}

export async function computeNeighborContext(keys: NeighborKeys) {
  return sha256([keys.north, keys.east, keys.south, keys.west].join("|"));
}

export async function computePowHash(input: PowInput) {
  return sha256(
    [
      "NCK_CHUNK_POW_V1",
      input.worldSeed,
      input.x,
      input.y,
      input.neighborContext,
      input.minerAddress,
      input.nonce,
    ].join("|"),
  );
}

export function isValidPow(hash: string, difficultyPrefix: string) {
  return hash.startsWith(difficultyPrefix);
}

export async function computeChunkKey(input: ChunkKeyInput) {
  return sha256(
    ["NCK_CHUNK_KEY_V1", input.powHash, input.neighborContext, input.x, input.y, input.minerAddress].join("|"),
  );
}

export async function computeSeedHash(seed: string) {
  return sha256(seed);
}

export function computeFrontierEdges(chunks: Record<string, Chunk>) {
  const edges: string[] = [];
  Object.values(chunks)
    .filter((chunk) => chunk.status === "unlocked")
    .forEach((chunk) => {
      Object.entries(directionOffsets).forEach(([direction, offset]) => {
        if (!isUnlocked(chunk.x + offset.x, chunk.y + offset.y, chunks)) {
          edges.push(`${chunk.x},${chunk.y}:${direction[0].toUpperCase()}`);
        }
      });
    });
  return edges.sort();
}

export async function computeFrontierRoot(edges: string[]) {
  return sha256(canonicalizeFrontierEdges(edges).join("|"));
}

export function canonicalizeFrontierEdges(edges: string[]) {
  return [...new Set(edges)].sort();
}

export function encodeRawEdges(edges: string[]) {
  return `${SHAPE_SEED_VERSION}|RAW|${base64urlEncode(canonicalizeFrontierEdges(edges).join(";"))}`;
}

export function decodeRawEdges(seed: string) {
  const [, type, payload] = seed.split("|");
  if (type !== "RAW" || !payload) throw new Error("Invalid RAW_EDGES seed.");
  return canonicalizeFrontierEdges(base64urlDecode(payload).split(";").filter(Boolean));
}

export function encodeRect(chunks: Record<string, Chunk>) {
  const unlocked = Object.values(chunks).filter((chunk) => chunk.status === "unlocked");
  if (!unlocked.length) return null;
  const xs = unlocked.map((chunk) => chunk.x);
  const ys = unlocked.map((chunk) => chunk.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (unlocked.length !== width * height) return null;
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      if (!isUnlocked(x, y, chunks)) return null;
    }
  }
  return `${SHAPE_SEED_VERSION}|RECT|${minX},${minY},${width},${height}`;
}

export function decodeRect(seed: string) {
  const [, type, payload] = seed.split("|");
  if (type !== "RECT" || !payload) throw new Error("Invalid RECT seed.");
  const [minX, minY, width, height] = payload.split(",").map((value) => Number(value));
  if (![minX, minY, width, height].every(Number.isInteger) || width <= 0 || height <= 0) {
    throw new Error("Invalid RECT dimensions.");
  }
  const chunks: Record<string, Chunk> = {};
  for (let x = minX; x < minX + width; x += 1) {
    for (let y = minY; y < minY + height; y += 1) {
      chunks[chunkId(x, y)] = { x, y, status: "unlocked", key: "RECT" };
    }
  }
  return computeFrontierEdges(chunks);
}

export function encodePathRle(edges: string[]) {
  const loops = traceFrontierLoops(edges);
  if (!loops.length) return null;
  const payload = loops
    .map((loop) => {
      const commands = compressPathCommands(loop.points);
      return `${loop.start.x},${loop.start.y}:${commands}`;
    })
    .sort()
    .join(";");
  return `${SHAPE_SEED_VERSION}|PATH|${payload}`;
}

export function decodePathRle(seed: string) {
  const [, type, payload] = seed.split("|");
  if (type !== "PATH" || !payload) throw new Error("Invalid PATH_RLE seed.");
  const edges: string[] = [];
  payload.split(";").forEach((loop) => {
    const [startRaw, commands] = loop.split(":");
    if (!startRaw || !commands) throw new Error("Invalid PATH_RLE loop.");
    const [startX, startY] = startRaw.split(",").map((value) => Number(value));
    if (!Number.isInteger(startX) || !Number.isInteger(startY)) throw new Error("Invalid PATH_RLE start.");
    let x = startX;
    let y = startY;
    const matches = [...commands.matchAll(/([NESW])(\d+)/g)];
    if (!matches.length || matches.map((match) => match[0]).join("") !== commands) {
      throw new Error("Invalid PATH_RLE commands.");
    }
    matches.forEach((match) => {
      const direction = match[1];
      const count = Number(match[2]);
      for (let index = 0; index < count; index += 1) {
        const next = stepPoint(x, y, direction);
        edges.push(edgeFromDirectedUnitSegment(x, y, next.x, next.y));
        x = next.x;
        y = next.y;
      }
    });
    if (x !== startX || y !== startY) throw new Error("PATH_RLE loop does not close.");
  });
  return canonicalizeFrontierEdges(edges);
}

export function decodeShapeSeed(seed: string) {
  const trimmed = String(seed || "").trim();
  if (trimmed.startsWith(`${SHAPE_SEED_VERSION}|RAW|`)) return decodeRawEdges(trimmed);
  if (trimmed.startsWith(`${SHAPE_SEED_VERSION}|PATH|`)) return decodePathRle(trimmed);
  if (trimmed.startsWith(`${SHAPE_SEED_VERSION}|RECT|`)) return decodeRect(trimmed);
  if (trimmed.startsWith("nckc1_")) return computeFrontierEdges(decodeProgramSeed(trimmed));
  if (trimmed.startsWith("nckc_")) return base64urlDecode(trimmed.slice(5)).split(";").filter(Boolean);
  throw new Error("Unknown shape seed format.");
}

export function canonicalizeSeed(seed: string) {
  const trimmed = String(seed || "").trim();
  const edges = decodeShapeSeed(trimmed);
  if (trimmed.startsWith(`${SHAPE_SEED_VERSION}|RAW|`)) return encodeRawEdges(edges);
  if (trimmed.startsWith(`${SHAPE_SEED_VERSION}|PATH|`)) return encodePathRle(edges) || "";
  if (trimmed.startsWith(`${SHAPE_SEED_VERSION}|RECT|`)) return canonicalizeRectSeed(trimmed);
  if (trimmed.startsWith("nckc1_")) return trimmed;
  return "";
}

export function getSeedByteLength(seed: string) {
  return new TextEncoder().encode(seed).length;
}

export function computeRawSeedBytes(frontierEdges: string[]) {
  return getSeedByteLength(encodeRawEdges(frontierEdges));
}

export async function validateSeedCandidate(
  seed: string,
  targetFrontierRoot: string,
  maxSeedBytes: number,
): Promise<SeedCandidate> {
  const byteLength = getSeedByteLength(seed);
  let decodedRoot = "";
  let isRootValid = false;
  let isCanonical = false;
  try {
    const decodedEdges = decodeShapeSeed(seed);
    decodedRoot = await computeFrontierRoot(decodedEdges);
    isRootValid = decodedRoot === targetFrontierRoot;
    isCanonical = canonicalizeSeed(seed) === seed;
  } catch (_error) {
    decodedRoot = "";
    isRootValid = false;
    isCanonical = false;
  }
  const isLengthValid = byteLength <= maxSeedBytes;
  const isValid = isRootValid && isLengthValid && isCanonical;
  return {
    seed,
    encodingType: seedEncodingType(seed),
    byteLength,
    decodedRoot,
    isRootValid,
    isLengthValid,
    isCanonical,
    isValid,
    status: isValid ? "valid" : !isRootValid ? "root_mismatch" : !isCanonical ? "non_canonical" : "too_long",
  };
}

export function searchSeedCandidates(chunks: Record<string, Chunk>) {
  const edges = computeFrontierEdges(chunks);
  const seeds = [
    encodeRect(chunks),
    encodePathRle(edges),
    encodeRawEdges(edges),
  ].filter(Boolean) as string[];
  return [...new Set(seeds)].sort((a, b) => getSeedByteLength(a) - getSeedByteLength(b) || a.localeCompare(b));
}

export function searchSeedCandidateAt(chunks: Record<string, Chunk>, attempt: number) {
  const fixedSeeds = searchSeedCandidates(chunks);
  if (attempt < fixedSeeds.length) return fixedSeeds[attempt];
  return encodeExpansionProgramSeed(chunks, attempt - fixedSeeds.length) || fixedSeeds[attempt % fixedSeeds.length];
}

export function encodeContour(edges: string[]) {
  return encodeRawEdges(edges);
}

export function mineContourSeed(chunks: Record<string, Chunk>, maxBytes = CONTOUR_SEED_MAX_BYTES, attempts = CONTOUR_SEED_SEARCH_ATTEMPTS) {
  const seeds = searchSeedCandidates(chunks);
  const seed = seeds[0] || encodeRawEdges(computeFrontierEdges(chunks));
  return {
    seed,
    byteLength: getSeedByteLength(seed),
    maxBytes,
    attempts,
    withinLimit: getSeedByteLength(seed) <= maxBytes,
  };
}

export function decodeContour(seed: string) {
  return decodeShapeSeed(seed);
}

export function describeContourPath(edges: string[]) {
  if (!edges.length) return "START(0,0)";
  const counts = edges.reduce<Record<string, number>>((acc, edge) => {
    const direction = edge.split(":")[1] || "";
    acc[direction] = (acc[direction] || 0) + 1;
    return acc;
  }, {});
  return ["START(0,0)", `N${counts.N || 0}`, `E${counts.E || 0}`, `S${counts.S || 0}`, `W${counts.W || 0}`].join(" ");
}

export function computeReward(neighborCount: number) {
  const multipliers: Record<number, number> = { 1: 1, 2: 0.7, 3: 0.3, 4: 0 };
  return 10 * (multipliers[neighborCount] ?? 0);
}

export function computeDisplayedDifficulty(unlockedCount: number, perimeter: number, recentAverageAttempts = 0) {
  return 1 + Math.floor(unlockedCount / 10) + Math.floor(perimeter / 30) + Math.floor(recentAverageAttempts / 4000);
}

export function getDifficultyPrefix(mode: "easy" | "normal" | "hard") {
  if (mode === "hard") return "0000";
  if (mode === "normal") return "000";
  return "00";
}

export async function initializeWorld(worldSeed = WORLD_SEED, minerAddress = MINER_ADDRESS): Promise<WorldState> {
  const genesisKey = await sha256(["NCK_GENESIS_CHUNK", worldSeed, 0, 0].join("|"));
  const chunks: Record<string, Chunk> = {
    [chunkId(0, 0)]: {
      x: 0,
      y: 0,
      status: "unlocked",
      key: genesisKey,
      minedBy: "GENESIS",
      unlockedAt: Date.now(),
    },
  };
  const edges = computeFrontierEdges(chunks);
  const rawSeedBytes = computeRawSeedBytes(edges);
  const initialMaxSeedBytes = Math.max(8, Math.ceil(rawSeedBytes * 0.7));
  const contourSeed = mineContourSeed(chunks, initialMaxSeedBytes);
  return {
    worldSeed,
    minerAddress,
    chunks,
    selectedChunk: { x: 0, y: 0 },
    difficultyTarget: "00",
    epoch: 0,
    frontierRoot: await computeFrontierRoot(edges),
    contourSeed: contourSeed.seed,
    seedMaxBytes: initialMaxSeedBytes,
    blockTargetSeconds: BLOCK_TARGET_SECONDS,
    retargetInterval: DIFFICULTY_RETARGET_INTERVAL,
    noBlockRelaxSeconds: NO_BLOCK_RELAX_SECONDS,
    unlockedCount: 1,
    perimeter: edges.length,
  };
}

export async function computeWorldMetrics(
  chunks: Record<string, Chunk>,
  recentAverageAttempts = 0,
  seedMaxBytes = CONTOUR_SEED_INITIAL_TARGET_BYTES,
  seedSearchAttempts = CONTOUR_SEED_SEARCH_ATTEMPTS,
): Promise<WorldMetrics> {
  const frontierEdges = computeFrontierEdges(chunks);
  const unlockedCount = Object.values(chunks).filter((chunk) => chunk.status === "unlocked").length;
  const rawSeedBytes = computeRawSeedBytes(frontierEdges);
  const contourSeed = mineContourSeed(chunks, seedMaxBytes, seedSearchAttempts);
  return {
    frontierEdges,
    frontierRoot: await computeFrontierRoot(frontierEdges),
    contourSeed: contourSeed.seed,
    contourSeedBytes: contourSeed.byteLength,
    contourSeedMaxBytes: contourSeed.maxBytes,
    contourSeedAttempts: contourSeed.attempts,
    contourSeedWithinLimit: contourSeed.withinLimit,
    rawSeedBytes,
    unlockedCount,
    candidateCount: Object.keys(computeCandidates(chunks)).length,
    perimeter: frontierEdges.length,
    displayedDifficulty: computeDisplayedDifficulty(unlockedCount, frontierEdges.length, recentAverageAttempts),
  };
}

export async function unlockChunk(worldState: WorldState, x: number, y: number, proof: UnlockProof): Promise<WorldState> {
  if (!isCandidate(x, y, worldState.chunks)) {
    throw new Error("Target chunk is not on the frontier.");
  }

  const chunks = {
    ...worldState.chunks,
    [chunkId(x, y)]: {
      x,
      y,
      status: "unlocked" as const,
      key: proof.chunkKey,
      minedBy: worldState.minerAddress,
      nonce: proof.nonce,
      powHash: proof.powHash,
      unlockedAt: Date.now(),
    },
  };
  const metrics = await computeWorldMetrics(chunks, 0, worldState.seedMaxBytes);
  return {
    ...worldState,
    chunks,
    selectedChunk: { x, y },
    epoch: worldState.epoch + 1,
    frontierRoot: metrics.frontierRoot,
    contourSeed: metrics.contourSeed,
    seedMaxBytes: worldState.seedMaxBytes,
    unlockedCount: metrics.unlockedCount,
    perimeter: metrics.perimeter,
  };
}

export function shortHash(value = "", head = 6, tail = 4) {
  if (!value || value === EMPTY_KEY) return value || EMPTY_KEY;
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function serializeWorldState(worldState: WorldState) {
  return {
    worldSeed: worldState.worldSeed,
    minerAddress: worldState.minerAddress,
    epoch: worldState.epoch,
    frontierRoot: worldState.frontierRoot,
    contourSeed: worldState.contourSeed,
    seedMaxBytes: worldState.seedMaxBytes,
    blockTargetSeconds: worldState.blockTargetSeconds,
    retargetInterval: worldState.retargetInterval,
    noBlockRelaxSeconds: worldState.noBlockRelaxSeconds,
    unlockedCount: worldState.unlockedCount,
    perimeter: worldState.perimeter,
    chunks: Object.fromEntries(
      Object.entries(worldState.chunks).map(([id, chunk]) => [
        id,
        {
          x: chunk.x,
          y: chunk.y,
          key: chunk.key,
          nonce: chunk.nonce,
          powHash: chunk.powHash,
          minedBy: chunk.minedBy,
        },
      ]),
    ),
  };
}

async function sha256(value: string) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error("Web Crypto SHA-256 is not available.");
  const encoded = new TextEncoder().encode(value);
  const digest = await cryptoApi.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64urlEncode(value: string) {
  const encoded = btoa(value);
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64urlDecode(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
}

function seedEncodingType(seed: string): SeedEncodingType {
  if (seed.startsWith(`${SHAPE_SEED_VERSION}|RAW|`)) return "RAW_EDGES";
  if (seed.startsWith(`${SHAPE_SEED_VERSION}|PATH|`)) return "PATH_RLE";
  if (seed.startsWith(`${SHAPE_SEED_VERSION}|RECT|`)) return "RECT";
  return "UNION";
}

function canonicalizeRectSeed(seed: string) {
  const edges = decodeRect(seed);
  const chunks = reconstructChunksFromRectSeed(seed);
  const canonical = encodeRect(chunks);
  if (!canonical || canonicalizeFrontierEdges(decodeRect(canonical)).join("|") !== canonicalizeFrontierEdges(edges).join("|")) return "";
  return canonical;
}

function reconstructChunksFromRectSeed(seed: string) {
  const [, , payload] = seed.split("|");
  const [minX, minY, width, height] = payload.split(",").map((value) => Number(value));
  const chunks: Record<string, Chunk> = {};
  for (let x = minX; x < minX + width; x += 1) {
    for (let y = minY; y < minY + height; y += 1) {
      chunks[chunkId(x, y)] = { x, y, status: "unlocked", key: "RECT" };
    }
  }
  return chunks;
}

function traceFrontierLoops(edges: string[]) {
  const segmentMap = new Map<string, Array<{ start: Point; end: Point; edge: string }>>();
  canonicalizeFrontierEdges(edges).forEach((edge) => {
    const segment = directedSegmentFromEdge(edge);
    const key = pointKey(segment.start);
    if (!segmentMap.has(key)) segmentMap.set(key, []);
    segmentMap.get(key)?.push(segment);
  });

  segmentMap.forEach((segments) => {
    segments.sort((a, b) => pointKey(a.end).localeCompare(pointKey(b.end)) || a.edge.localeCompare(b.edge));
  });

  const unused = new Set(canonicalizeFrontierEdges(edges));
  const loops: Array<{ start: Point; points: Point[] }> = [];

  while (unused.size) {
    const firstEdge = [...unused].sort()[0];
    const firstSegment = directedSegmentFromEdge(firstEdge);
    const start = firstSegment.start;
    const points = [start];
    let current = start;

    for (let guard = 0; guard < edges.length + 8; guard += 1) {
      const candidates = (segmentMap.get(pointKey(current)) || []).filter((segment) => unused.has(segment.edge));
      if (!candidates.length) return [];
      const segment = candidates[0];
      unused.delete(segment.edge);
      current = segment.end;
      points.push(current);
      if (current.x === start.x && current.y === start.y) break;
    }

    if (current.x !== start.x || current.y !== start.y) return [];
    loops.push({ start, points });
  }

  return loops.sort((a, b) => pointKey(a.start).localeCompare(pointKey(b.start)));
}

type Point = { x: number; y: number };

function directedSegmentFromEdge(edge: string) {
  const [coord, direction] = edge.split(":");
  const { x, y } = parseChunkId(coord);
  if (direction === "N") return { start: { x, y: y + 1 }, end: { x: x + 1, y: y + 1 }, edge };
  if (direction === "E") return { start: { x: x + 1, y: y + 1 }, end: { x: x + 1, y }, edge };
  if (direction === "S") return { start: { x: x + 1, y }, end: { x, y }, edge };
  if (direction === "W") return { start: { x, y }, end: { x, y: y + 1 }, edge };
  throw new Error("Invalid frontier edge direction.");
}

function edgeFromDirectedUnitSegment(x: number, y: number, nextX: number, nextY: number) {
  if (nextX === x + 1 && nextY === y) return `${x},${y - 1}:N`;
  if (nextX === x && nextY === y - 1) return `${x - 1},${y}:E`;
  if (nextX === x - 1 && nextY === y) return `${nextX},${y}:S`;
  if (nextX === x && nextY === y + 1) return `${x},${y}:W`;
  throw new Error("PATH_RLE only supports unit orthogonal segments.");
}

function compressPathCommands(points: Point[]) {
  const commands: Array<{ direction: string; count: number }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const direction = directionBetween(prev, next);
    const last = commands[commands.length - 1];
    if (last?.direction === direction) last.count += 1;
    else commands.push({ direction, count: 1 });
  }
  return commands.map((command) => `${command.direction}${command.count}`).join("");
}

function directionBetween(prev: Point, next: Point) {
  if (next.x === prev.x + 1 && next.y === prev.y) return "E";
  if (next.x === prev.x - 1 && next.y === prev.y) return "W";
  if (next.x === prev.x && next.y === prev.y + 1) return "N";
  if (next.x === prev.x && next.y === prev.y - 1) return "S";
  throw new Error("Invalid PATH_RLE segment.");
}

function stepPoint(x: number, y: number, direction: string) {
  if (direction === "E") return { x: x + 1, y };
  if (direction === "W") return { x: x - 1, y };
  if (direction === "N") return { x, y: y + 1 };
  if (direction === "S") return { x, y: y - 1 };
  throw new Error("Invalid PATH_RLE direction.");
}

function pointKey(point: Point) {
  return `${point.x},${point.y}`;
}

function findBestExpansionProgram(unlockedIds: Set<string>, attempts: number) {
  const targetIds = new Set([...unlockedIds].filter((id) => id !== chunkId(0, 0)));
  let bestIndexes: number[] | null = null;
  let completedAttempts = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    completedAttempts += 1;
    const indexes = buildExpansionProgram(targetIds, attempt);
    if (!indexes) continue;
    if (!bestIndexes || compareBytes(packExpansionProgram(indexes), packExpansionProgram(bestIndexes)) < 0) {
      bestIndexes = indexes;
    }
  }

  return {
    indexes: bestIndexes || [],
    attempts: completedAttempts,
  };
}

export function encodeExpansionProgramSeed(chunks: Record<string, Chunk>, attempt: number) {
  const targetIds = new Set(
    Object.values(chunks)
      .filter((chunk) => chunk.status === "unlocked" && !(chunk.x === 0 && chunk.y === 0))
      .map((chunk) => chunkId(chunk.x, chunk.y)),
  );
  const indexes = buildExpansionProgram(targetIds, attempt);
  if (!indexes) return null;
  return `nckc1_${base64urlEncodeBytes(packExpansionProgram(indexes))}`;
}

function buildExpansionProgram(targetIds: Set<string>, attempt: number) {
  const partial = createProgramGenesisChunks();
  const remaining = new Set(targetIds);
  const indexes: number[] = [];

  while (remaining.size) {
    const candidates = sortedCandidateList(partial).filter((candidate) => remaining.has(chunkId(candidate.x, candidate.y)));
    if (!candidates.length) return null;
    const target = chooseProgramCandidate(candidates, remaining, attempt, indexes.length);
    const candidateList = sortedCandidateList(partial);
    const index = candidateList.findIndex((candidate) => candidate.x === target.x && candidate.y === target.y);
    if (index < 0) return null;
    indexes.push(index);
    partial[chunkId(target.x, target.y)] = { x: target.x, y: target.y, status: "unlocked", key: "PROGRAM" };
    remaining.delete(chunkId(target.x, target.y));
  }

  return indexes;
}

function chooseProgramCandidate(candidates: Chunk[], remaining: Set<string>, attempt: number, step: number) {
  const sorted = [...candidates];
  if (attempt === 0) {
    sorted.sort((a, b) => manhattan(a) - manhattan(b) || a.y - b.y || a.x - b.x);
    return sorted[0];
  }
  if (attempt === 1) {
    sorted.sort((a, b) => a.x - b.x || a.y - b.y);
    return sorted[0];
  }
  if (attempt === 2) {
    sorted.sort((a, b) => expansionNeighborScore(b, remaining) - expansionNeighborScore(a, remaining) || manhattan(a) - manhattan(b));
    return sorted[0];
  }

  const seed = hashSmall(`${attempt}:${step}:${remaining.size}`);
  return sorted[seed % sorted.length];
}

function sortedCandidateList(chunks: Record<string, Chunk>) {
  return Object.values(computeCandidates(chunks)).sort((a, b) => a.y - b.y || a.x - b.x);
}

function createProgramGenesisChunks() {
  return {
    [chunkId(0, 0)]: { x: 0, y: 0, status: "unlocked" as const, key: "GENESIS" },
  };
}

function packExpansionProgram(indexes: number[]) {
  const chunks = createProgramGenesisChunks();
  const writer = new BitWriter();
  writer.writeVarint(indexes.length);

  for (const index of indexes) {
    const candidates = sortedCandidateList(chunks);
    if (!candidates.length || index >= candidates.length) throw new Error("Invalid contour program.");
    const width = bitWidth(candidates.length - 1);
    if (width > 0) writer.writeBits(index, width);
    const target = candidates[index];
    chunks[chunkId(target.x, target.y)] = { x: target.x, y: target.y, status: "unlocked", key: "PROGRAM" };
  }

  return writer.toBytes();
}

function decodeProgramSeed(seed: string) {
  const bytes = base64urlDecodeBytes(seed.slice(6));
  const reader = new BitReader(bytes);
  const steps = reader.readVarint();
  const chunks = createProgramGenesisChunks();

  for (let step = 0; step < steps; step += 1) {
    const candidates = sortedCandidateList(chunks);
    if (!candidates.length) throw new Error("Contour seed has no candidate to replay.");
    const width = bitWidth(candidates.length - 1);
    const index = width > 0 ? reader.readBits(width) : 0;
    const target = candidates[index];
    if (!target) throw new Error("Contour seed points outside the candidate frontier.");
    chunks[chunkId(target.x, target.y)] = { x: target.x, y: target.y, status: "unlocked", key: "PROGRAM" };
  }

  return chunks;
}

function bitWidth(maxValue: number) {
  return maxValue <= 0 ? 0 : Math.ceil(Math.log2(maxValue + 1));
}

function manhattan(chunk: Chunk) {
  return Math.abs(chunk.x) + Math.abs(chunk.y);
}

function expansionNeighborScore(chunk: Chunk, remaining: Set<string>) {
  return Object.values(getNeighborCoords(chunk.x, chunk.y)).filter((coord) => remaining.has(chunkId(coord.x, coord.y))).length;
}

function compareBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return a.length - b.length;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function hashSmall(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function base64urlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64urlDecodeBytes(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

class BitWriter {
  private bytes: number[] = [];
  private current = 0;
  private used = 0;

  writeVarint(value: number) {
    let next = value;
    do {
      let byte = next & 0x7f;
      next >>>= 7;
      if (next) byte |= 0x80;
      this.writeBits(byte, 8);
    } while (next);
  }

  writeBits(value: number, width: number) {
    for (let bit = width - 1; bit >= 0; bit -= 1) {
      this.current = (this.current << 1) | ((value >> bit) & 1);
      this.used += 1;
      if (this.used === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.used = 0;
      }
    }
  }

  toBytes() {
    if (this.used) {
      this.bytes.push(this.current << (8 - this.used));
      this.current = 0;
      this.used = 0;
    }
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  private offset = 0;

  constructor(private bytes: Uint8Array) {}

  readVarint() {
    let shift = 0;
    let value = 0;
    while (true) {
      const byte = this.readBits(8);
      value |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
      shift += 7;
      if (shift > 28) throw new Error("Contour seed varint is too large.");
    }
  }

  readBits(width: number) {
    let value = 0;
    for (let index = 0; index < width; index += 1) {
      if (this.offset >= this.bytes.length * 8) throw new Error("Contour seed ended early.");
      const byte = this.bytes[Math.floor(this.offset / 8)];
      const bit = 7 - (this.offset % 8);
      value = (value << 1) | ((byte >> bit) & 1);
      this.offset += 1;
    }
    return value;
  }
}
