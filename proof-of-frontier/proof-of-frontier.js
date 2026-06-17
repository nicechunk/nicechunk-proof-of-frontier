import { initI18n, t } from "../src/i18n.js";
import "./style.css";
import "../src/site-header.css";
import { finishSiteLoading, setSiteLoadingProgress } from "../src/site-ui.js";
import {
  MINER_ADDRESS,
  chunkId,
  computeCandidates,
  computeFrontierRoot,
  computeReward,
  computeSeedHash,
  computeWorldMetrics,
  decodeShapeSeed,
  describeContourPath,
  encodeRawEdges,
  getSeedByteLength,
  initializeWorld,
  isCandidate,
  isUnlocked,
  mineContourSeed,
  searchSeedCandidateAt,
  searchSeedCandidates,
  shortHash,
  validateSeedCandidate,
} from "../src/lib/proof-of-frontier.ts";

const canvas = document.querySelector("#worldCanvas");
const ctx = canvas.getContext("2d");

const els = {
  growWorldButton: document.querySelector("#randomMineButton"),
  resetButton: document.querySelector("#resetButton"),
  selectionMessage: document.querySelector("#selectionMessage"),
  selectedCoords: document.querySelector("#selectedCoords"),
  selectedStatus: document.querySelector("#selectedStatus"),
  unlockedCount: document.querySelector("#unlockedCount"),
  candidateCount: document.querySelector("#candidateCount"),
  perimeterValue: document.querySelector("#perimeterValue"),
  frontierRoot: document.querySelector("#frontierRoot"),
  currentEpoch: document.querySelector("#currentEpoch"),
  targetFrontierRoot: document.querySelector("#targetFrontierRoot"),
  maxSeedBytes: document.querySelector("#maxSeedBytes"),
  rawSeedBytes: document.querySelector("#rawSeedBytes"),
  candidateSeedBytes: document.querySelector("#candidateSeedBytes"),
  lastCalculationCount: document.querySelector("#lastCalculationCount"),
  currentEpochCalculationCount: document.querySelector("#currentEpochCalculationCount"),
  bestAcceptedSeedBytes: document.querySelector("#bestAcceptedSeedBytes"),
  blocksInLastMinute: document.querySelector("#blocksInLastMinute"),
  lastBlockAge: document.querySelector("#lastBlockAge"),
  nextRetargetIn: document.querySelector("#nextRetargetIn"),
  difficultyStatus: document.querySelector("#difficultyStatus"),
  stuckMinutes: document.querySelector("#stuckMinutes"),
  seedMiningStatus: document.querySelector("#seedMiningStatus"),
  difficultyMeterFill: document.querySelector("#difficultyMeterFill"),
  difficultyMeterText: document.querySelector("#difficultyMeterText"),
  candidateEncoding: document.querySelector("#candidateEncoding"),
  candidateDecodedRoot: document.querySelector("#candidateDecodedRoot"),
  candidateRootValid: document.querySelector("#candidateRootValid"),
  candidateLengthValid: document.querySelector("#candidateLengthValid"),
  candidateCanonical: document.querySelector("#candidateCanonical"),
  candidateSeed: document.querySelector("#candidateSeed"),
  startSearchButton: document.querySelector("#startSearchButton"),
  stopButton: document.querySelector("#stopButton"),
  searchOneButton: document.querySelector("#searchOneButton"),
  submitCandidateButton: document.querySelector("#submitCandidateButton"),
  autoRunButton: document.querySelector("#autoRunButton"),
  autoSolveButton: document.querySelector("#autoSolveButton"),
  retargetNowButton: document.querySelector("#retargetNowButton"),
  resetDifficultyButton: document.querySelector("#resetDifficultyButton"),
  contourSeedShort: document.querySelector("#contourSeedShort"),
  contourSeedFull: document.querySelector("#contourSeedFull"),
  contourSeedLength: document.querySelector("#contourSeedLength"),
  contourSeedInput: document.querySelector("#contourSeedInput"),
  contourPath: document.querySelector("#contourPath"),
  decodeSeedButton: document.querySelector("#decodeSeedButton"),
  copySeedButton: document.querySelector("#copySeedButton"),
  copyStateButton: document.querySelector("#copyStateButton"),
  toggleLogButton: document.querySelector("#toggleLogButton"),
  transactionLog: document.querySelector("#transactionLog"),
  formulaTitle: document.querySelector("#formulaTitle"),
  steps: [...document.querySelectorAll(".step")],
};

let worldState = null;
let metrics = null;
let difficulty = null;
let candidate = null;
let currentEpoch = 1;
let bestAcceptedSeedBytes = null;
let isSearching = false;
let isAutoRunning = false;
let searchCursor = 0;
let searchTimer = null;
let blockSolvedTimes = [];
let transactionLog = [];
let decodedEdges = [];
let decodedFlashUntil = 0;
let selectedChunk = { x: 0, y: 0 };
let drawInfo = { span: 10, cell: 20, offsetX: 0, offsetY: 0, dpr: 1 };
let lastCalculationCount = 0;
let currentEpochCalculationCount = 0;

const UI_REFRESH_INTERVAL_MS = 80;

setSiteLoadingProgress(34);
await initI18n();
setSiteLoadingProgress(54);
worldState = await initializeWorld();
selectedChunk = worldState.selectedChunk;
await refreshMetrics();
initializeDifficulty();
renderAll();
finishSiteLoading();

canvas.addEventListener("click", handleCanvasClick);
window.addEventListener("resize", () => renderCanvas());
window.addEventListener("nicechunk:languagechange", () => renderAll());
els.growWorldButton.addEventListener("click", growWorld);
els.resetButton.addEventListener("click", resetWorld);
els.startSearchButton.addEventListener("click", startSeedSearch);
els.stopButton.addEventListener("click", stopAllWork);
els.searchOneButton.addEventListener("click", searchOneCandidate);
els.submitCandidateButton.addEventListener("click", submitCandidate);
els.autoRunButton.addEventListener("click", startAutoRun);
els.autoSolveButton.addEventListener("click", autoSolve);
els.retargetNowButton.addEventListener("click", () => retargetDifficulty({ force: true }));
els.resetDifficultyButton.addEventListener("click", resetDifficulty);
els.decodeSeedButton.addEventListener("click", decodeCurrentSeed);
els.copySeedButton.addEventListener("click", () => copyText(candidate?.seed || metrics.contourSeed, "proofOfFrontier.messages.seedCopied"));
els.copyStateButton.addEventListener("click", () =>
  copyText(JSON.stringify(exportDemoState(), null, 2), "proofOfFrontier.messages.stateCopied"),
);
els.toggleLogButton.addEventListener("click", () => {
  els.transactionLog.classList.toggle("open");
  els.toggleLogButton.textContent = els.transactionLog.classList.contains("open")
    ? t("proofOfFrontier.actions.hideLog")
    : t("proofOfFrontier.actions.showLog");
});

setInterval(() => {
  retargetDifficulty();
  renderDifficulty();
}, 1000);

async function refreshMetrics() {
  metrics = await computeWorldMetrics(worldState.chunks, 0, difficulty?.maxSeedBytes || worldState.seedMaxBytes);
  worldState = {
    ...worldState,
    frontierRoot: metrics.frontierRoot,
    contourSeed: metrics.contourSeed,
    unlockedCount: metrics.unlockedCount,
    perimeter: metrics.perimeter,
  };
}

function initializeDifficulty() {
  const rawSeedBytes = metrics.rawSeedBytes;
  difficulty = {
    maxSeedBytes: Math.max(8, Math.ceil(rawSeedBytes * 0.7)),
    minSeedBytes: 8,
    rawSeedBytes,
    targetBlockIntervalMs: 60_000,
    retargetIntervalMs: 60_000,
    lastRetargetAt: Date.now(),
    lastBlockAt: null,
    blocksInLastMinute: 0,
    stuckMinutes: 0,
    status: "stable",
  };
}

async function resetWorld() {
  stopAllWork();
  worldState = await initializeWorld();
  selectedChunk = worldState.selectedChunk;
  currentEpoch = 1;
  bestAcceptedSeedBytes = null;
  candidate = null;
  transactionLog = [];
  blockSolvedTimes = [];
  decodedEdges = [];
  lastCalculationCount = 0;
  currentEpochCalculationCount = 0;
  await refreshMetrics();
  initializeDifficulty();
  renderAll();
}

async function growWorld(options = {}) {
  const { keepRunning = false } = options;
  if (!keepRunning) stopAllWork();
  const candidates = Object.values(computeCandidates(worldState.chunks));
  if (!candidates.length) return;
  const oldRoot = metrics.frontierRoot;
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const key = await computeSeedHash(`DEMO_CHUNK|${Date.now()}|${target.x}|${target.y}`);
  worldState = {
    ...worldState,
    chunks: {
      ...worldState.chunks,
      [chunkId(target.x, target.y)]: {
        x: target.x,
        y: target.y,
        status: "unlocked",
        key,
        minedBy: "WORLD_GROWTH_DEMO",
        unlockedAt: Date.now(),
      },
    },
  };
  selectedChunk = { x: target.x, y: target.y };
  candidate = null;
  bestAcceptedSeedBytes = null;
  await refreshMetrics();
  difficulty.rawSeedBytes = metrics.rawSeedBytes;
  difficulty.maxSeedBytes = Math.min(Math.max(difficulty.minSeedBytes, difficulty.maxSeedBytes), difficulty.rawSeedBytes);
  appendEvent({
    type: "WorldFrontierChanged",
    oldFrontierRoot: oldRoot,
    newFrontierRoot: metrics.frontierRoot,
    unlockedChunks: metrics.unlockedCount,
    perimeter: metrics.perimeter,
  });
  renderAll();
}

async function handleCanvasClick(event) {
  const coord = canvasEventToChunk(event);
  if (!coord) return;
  selectedChunk = coord;
  renderSelected();
  renderCanvas();
}

function startSeedSearch() {
  if (isAutoRunning) return;
  if (isSearching) return;
  isSearching = true;
  setSeedStatus("proofOfFrontier.status.searching");
  searchTimer = setInterval(async () => {
    await searchOneCandidate();
    if (candidate?.isValid) stopSeedSearch(false);
  }, 320);
  setControls();
}

function stopSeedSearch(render = true) {
  isSearching = false;
  if (searchTimer) clearInterval(searchTimer);
  searchTimer = null;
  if (render) {
    setSeedStatus("proofOfFrontier.status.stopped");
    setControls();
  }
}

function stopAllWork(render = true) {
  isAutoRunning = false;
  stopSeedSearch(render);
}

async function startAutoRun() {
  if (isAutoRunning) return;
  stopSeedSearch(false);
  isAutoRunning = true;
  setSeedStatus("proofOfFrontier.status.autoRunning", "valid");
  setControls();

  while (isAutoRunning) {
    const solved = await autoSolve({ keepRunning: true, fullSpeed: true });
    if (!isAutoRunning) break;
    if (solved) await growWorld({ keepRunning: true });
    if (isAutoRunning) {
      setSeedStatus("proofOfFrontier.status.autoRunning", "valid");
    }
    await yieldToBrowser();
  }

  if (!isAutoRunning) setSeedStatus("proofOfFrontier.status.stopped");
  setControls();
}

async function searchOneCandidate() {
  const seeds = searchSeedCandidates(worldState.chunks);
  if (!seeds.length) return;
  const seed = seeds[searchCursor % seeds.length];
  searchCursor += 1;
  lastCalculationCount = 1;
  candidate = await validateSeedCandidate(seed, metrics.frontierRoot, difficulty.maxSeedBytes);
  currentEpochCalculationCount += lastCalculationCount;
  setSeedStatus(statusKeyForCandidate(candidate), candidate.isValid ? "valid" : candidate.status === "too_long" ? "error" : "");
  renderCandidate();
  renderDifficulty();
  setActiveStep(candidate.isValid ? 4 : 3);
  setControls();
}

async function autoSolve(options = {}) {
  const { keepRunning = false, fullSpeed = false } = options;
  if (!keepRunning) stopSeedSearch(false);
  let calculations = 0;
  let bestAttempt = null;
  let lastUiRefresh = performance.now();

  while (fullSpeed ? isAutoRunning : calculations < 1) {
    const seed = searchSeedCandidateAt(worldState.chunks, searchCursor);
    if (!seed) break;
    searchCursor += 1;
    calculations += 1;
    const result = await validateSeedCandidate(seed, metrics.frontierRoot, difficulty.maxSeedBytes);
    currentEpochCalculationCount += 1;
    bestAttempt = chooseVisibleCandidate(bestAttempt, result);
    if (result.isValid) {
      candidate = result;
      lastCalculationCount = calculations;
      renderCandidate();
      renderDifficulty();
      return submitCandidate({ countValidation: false });
    }

    const now = performance.now();
    if (fullSpeed && now - lastUiRefresh >= UI_REFRESH_INTERVAL_MS) {
      lastCalculationCount = calculations;
      candidate = bestAttempt;
      renderCandidate();
      renderDifficulty();
      retargetDifficulty();
      await yieldToBrowser();
      lastUiRefresh = performance.now();
    }
  }

  lastCalculationCount = calculations;
  candidate = bestAttempt;
  renderCandidate();
  renderDifficulty();
  setSeedStatus("proofOfFrontier.status.noValidSeed", "error");
  return false;
}

async function submitCandidate(options = {}) {
  const { countValidation = true } = options;
  if (!candidate?.seed) {
    setSeedStatus("proofOfFrontier.status.noCandidate", "error");
    return false;
  }

  const result = await validateSeedCandidate(candidate.seed, metrics.frontierRoot, difficulty.maxSeedBytes);
  if (countValidation) {
    lastCalculationCount = 1;
    currentEpochCalculationCount += lastCalculationCount;
  }
  candidate = result;
  renderCandidate();

  if (!result.isRootValid) {
    setSeedStatus("proofOfFrontier.status.rootMismatch", "error");
    return false;
  }
  if (!result.isCanonical) {
    setSeedStatus("proofOfFrontier.status.nonCanonical", "error");
    return false;
  }
  if (!result.isLengthValid) {
    setSeedStatus("proofOfFrontier.status.seedTooLong", "error");
    return false;
  }

  await solveEpoch(result);
  return true;
}

async function solveEpoch(result) {
  const now = Date.now();
  const reward = computeBlockReward(result.byteLength, difficulty.maxSeedBytes);
  const block = {
    type: "SeedBlockSolved",
    epoch: currentEpoch,
    targetFrontierRoot: metrics.frontierRoot,
    seedHash: await computeSeedHash(result.seed),
    seedBytes: result.byteLength,
    maxSeedBytes: difficulty.maxSeedBytes,
    calculations: currentEpochCalculationCount,
    miner: MINER_ADDRESS,
    reward,
    solvedAt: now,
  };
  appendEvent(block);
  difficulty.lastBlockAt = now;
  difficulty.blocksInLastMinute += 1;
  difficulty.stuckMinutes = 0;
  blockSolvedTimes = [...blockSolvedTimes.slice(-11), now];
  bestAcceptedSeedBytes = bestAcceptedSeedBytes == null ? result.byteLength : Math.min(bestAcceptedSeedBytes, result.byteLength);
  currentEpoch += 1;
  candidate = null;
  searchCursor = 0;
  currentEpochCalculationCount = 0;
  setSeedStatus("proofOfFrontier.status.valid", "valid");
  setActiveStep(5);
  renderAll();
}

function retargetDifficulty({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - difficulty.lastRetargetAt < difficulty.retargetIntervalMs) return;

  const oldMax = difficulty.maxSeedBytes;
  const blocks = difficulty.blocksInLastMinute;
  const raw = difficulty.rawSeedBytes;
  const hardenStep = Math.max(8, Math.floor(raw * 0.03));
  const relaxStep = Math.max(8, Math.floor(raw * 0.05));
  let reason = "target_speed";

  if (blocks >= 2) {
    difficulty.maxSeedBytes = Math.max(difficulty.minSeedBytes, difficulty.maxSeedBytes - hardenStep);
    difficulty.stuckMinutes = 0;
    difficulty.status = "hardening";
    reason = "blocks_too_fast";
  } else if (blocks === 0) {
    difficulty.stuckMinutes += 1;
    let step = relaxStep;
    reason = "no_block_relax";
    if (difficulty.stuckMinutes >= 10) {
      step = relaxStep * 5;
      reason = "long_stuck_force_relax";
    } else if (difficulty.stuckMinutes >= 3) {
      step = relaxStep * 2;
      reason = "stuck_relax";
    }
    difficulty.maxSeedBytes = Math.min(raw, difficulty.maxSeedBytes + step);
    difficulty.status = "relaxing";
  } else {
    difficulty.stuckMinutes = 0;
    difficulty.status = "stable";
  }

  if (difficulty.maxSeedBytes >= raw) difficulty.status = "guaranteed_solvable";
  appendDifficultyRetargetEvent(oldMax, difficulty.maxSeedBytes, reason);
  difficulty.blocksInLastMinute = 0;
  difficulty.lastRetargetAt = now;
  renderAll();
}

function resetDifficulty() {
  const oldMax = difficulty.maxSeedBytes;
  difficulty.maxSeedBytes = Math.max(difficulty.minSeedBytes, Math.ceil(difficulty.rawSeedBytes * 0.7));
  difficulty.blocksInLastMinute = 0;
  difficulty.stuckMinutes = 0;
  difficulty.status = "stable";
  difficulty.lastRetargetAt = Date.now();
  appendDifficultyRetargetEvent(oldMax, difficulty.maxSeedBytes, "manual_reset");
  renderAll();
}

function appendDifficultyRetargetEvent(oldMaxSeedBytes, newMaxSeedBytes, reason) {
  appendEvent({
    type: "DifficultyRetargeted",
    oldMaxSeedBytes,
    newMaxSeedBytes,
    reason,
    blocksInLastMinute: difficulty.blocksInLastMinute,
    stuckMinutes: difficulty.stuckMinutes,
  });
}

function appendEvent(event) {
  transactionLog = [event, ...transactionLog].slice(0, 12);
}

function renderAll() {
  renderCanvas();
  renderSelected();
  renderWorldState();
  renderDifficulty();
  renderCandidate();
  renderContour();
  renderTransactions();
  setControls();
}

function renderSelected() {
  const status = getSelectedStatus(selectedChunk.x, selectedChunk.y);
  els.selectedCoords.textContent = `(${selectedChunk.x}, ${selectedChunk.y})`;
  els.selectedStatus.textContent = t(`proofOfFrontier.chunkStatus.${status}`);
  if (status === "unlocked") {
    els.selectionMessage.textContent = t("proofOfFrontier.messages.unlocked");
    setActiveStep(1);
  } else if (status === "candidate") {
    els.selectionMessage.textContent = t("proofOfFrontier.messages.candidate");
    setActiveStep(2);
  } else {
    els.selectionMessage.textContent = t("proofOfFrontier.messages.locked");
  }
}

function renderWorldState() {
  els.unlockedCount.textContent = String(metrics.unlockedCount);
  els.candidateCount.textContent = String(metrics.candidateCount);
  els.perimeterValue.textContent = String(metrics.perimeter);
  els.frontierRoot.textContent = shortHash(metrics.frontierRoot, 14, 10);
  els.contourSeedShort.textContent = shortHash(metrics.contourSeed, 18, 10);
}

function renderDifficulty() {
  els.currentEpoch.textContent = String(currentEpoch);
  els.targetFrontierRoot.textContent = shortHash(metrics.frontierRoot, 14, 10);
  els.maxSeedBytes.textContent = String(difficulty.maxSeedBytes);
  els.rawSeedBytes.textContent = String(difficulty.rawSeedBytes);
  els.lastCalculationCount.textContent = String(lastCalculationCount);
  els.currentEpochCalculationCount.textContent = String(currentEpochCalculationCount);
  els.bestAcceptedSeedBytes.textContent = bestAcceptedSeedBytes == null ? "-" : String(bestAcceptedSeedBytes);
  els.blocksInLastMinute.textContent = String(difficulty.blocksInLastMinute);
  els.lastBlockAge.textContent = difficulty.lastBlockAt ? `${Math.floor((Date.now() - difficulty.lastBlockAt) / 1000)}s` : "-";
  els.nextRetargetIn.textContent = `${Math.max(0, Math.ceil((difficulty.retargetIntervalMs - (Date.now() - difficulty.lastRetargetAt)) / 1000))}s`;
  els.stuckMinutes.textContent = String(difficulty.stuckMinutes);
  els.difficultyStatus.textContent = t(`proofOfFrontier.difficultyStatus.${difficulty.status}`);
  els.difficultyStatus.className = difficulty.status;

  const range = Math.max(1, difficulty.rawSeedBytes - difficulty.minSeedBytes);
  const progress = Math.max(0, Math.min(1, (difficulty.maxSeedBytes - difficulty.minSeedBytes) / range));
  els.difficultyMeterFill.style.width = `${progress * 100}%`;
  els.difficultyMeterText.textContent = t("proofOfFrontier.worldState.seedTargetValue", {
    max: difficulty.maxSeedBytes,
    raw: difficulty.rawSeedBytes,
  });
}

function renderCandidate() {
  els.candidateEncoding.textContent = candidate ? t(`proofOfFrontier.encoding.${candidate.encodingType}`) : "-";
  els.candidateSeedBytes.textContent = candidate ? String(candidate.byteLength) : "-";
  els.candidateDecodedRoot.textContent = candidate?.decodedRoot ? shortHash(candidate.decodedRoot, 14, 10) : "-";
  els.candidateRootValid.textContent = candidate ? boolLabel(candidate.isRootValid) : "-";
  els.candidateLengthValid.textContent = candidate ? boolLabel(candidate.isLengthValid) : "-";
  els.candidateCanonical.textContent = candidate ? boolLabel(candidate.isCanonical) : "-";
  els.candidateSeed.textContent = candidate?.seed || "-";
}

function renderContour() {
  const bestSeed = candidate?.seed || metrics.contourSeed;
  const bytes = getSeedByteLength(bestSeed);
  els.contourSeedFull.textContent = bestSeed;
  els.contourSeedLength.textContent = t("proofOfFrontier.contour.seedLength", {
    bytes,
    target: difficulty.maxSeedBytes,
  });
  els.contourPath.textContent = describeContourPath(metrics.frontierEdges);
}

function renderTransactions() {
  if (!transactionLog.length) {
    const empty = document.createElement("p");
    empty.className = "small-note";
    empty.textContent = t("proofOfFrontier.transactions.empty");
    els.transactionLog.replaceChildren(empty);
    return;
  }

  els.transactionLog.replaceChildren(
    ...transactionLog.map((event) => {
      const item = document.createElement("article");
      item.className = "tx-item";
      const title = document.createElement("strong");
      title.textContent = event.type;
      item.append(title);

      Object.entries(event)
        .filter(([key]) => key !== "type")
        .slice(0, 8)
        .forEach(([key, value]) => {
          const line = document.createElement("span");
          line.textContent = `${key}: ${formatEventValue(value)}`;
          item.append(line);
        });

      return item;
    }),
  );
}

function renderCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.max(320, Math.floor(rect.width || 700));
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const chunks = Object.values(worldState.chunks);
  const candidates = computeCandidates(worldState.chunks);
  const decodedCoords = decodedEdges.flatMap((edge) => {
    const [coord] = edge.split(":");
    return coord ? [parseCoord(coord)] : [];
  });
  const coords = [...chunks, ...Object.values(candidates), selectedChunk, ...decodedCoords];
  const maxAbs = coords.reduce((max, chunk) => Math.max(max, Math.abs(chunk.x), Math.abs(chunk.y)), 0);
  const span = Math.max(10, maxAbs + 3);
  const padding = 18;
  const cell = (size - padding * 2) / (span * 2 + 1);
  drawInfo = { span, cell, offsetX: padding, offsetY: padding, dpr };

  ctx.fillStyle = "#051019";
  ctx.fillRect(0, 0, size, size);

  for (let x = -span; x <= span; x += 1) {
    for (let y = -span; y <= span; y += 1) drawChunkCell(x, y, candidates);
  }

  metrics.frontierEdges.forEach((edge) => drawFrontierEdge(edge, "rgba(140, 255, 194, 0.95)", Math.max(2, cell * 0.12)));

  if (decodedEdges.length && performance.now() < decodedFlashUntil) {
    const alpha = 0.42 + Math.sin(performance.now() / 80) * 0.32;
    decodedEdges.forEach((edge) => drawFrontierEdge(edge, `rgba(255, 209, 102, ${alpha})`, Math.max(3, cell * 0.16)));
    requestAnimationFrame(renderCanvas);
  }
}

function drawChunkCell(x, y, candidates) {
  const bounds = cellBounds(x, y);
  const id = chunkId(x, y);
  const selected = selectedChunk?.x === x && selectedChunk?.y === y;
  const unlocked = isUnlocked(x, y, worldState.chunks);
  const candidateChunk = Boolean(candidates[id]);

  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(88, 223, 255, 0.08)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.018)";
  ctx.fillRect(bounds.x, bounds.y, bounds.size, bounds.size);
  ctx.strokeRect(bounds.x, bounds.y, bounds.size, bounds.size);

  if (unlocked) {
    ctx.fillStyle = x === 0 && y === 0 ? "rgba(88, 223, 255, 0.86)" : "rgba(140, 255, 194, 0.78)";
    ctx.fillRect(bounds.x + 2, bounds.y + 2, bounds.size - 4, bounds.size - 4);
    ctx.shadowColor = "rgba(140, 255, 194, 0.8)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "rgba(224, 255, 244, 0.72)";
    ctx.strokeRect(bounds.x + 2, bounds.y + 2, bounds.size - 4, bounds.size - 4);
  } else if (candidateChunk) {
    ctx.fillStyle = "rgba(255, 209, 102, 0.14)";
    ctx.fillRect(bounds.x + 3, bounds.y + 3, bounds.size - 6, bounds.size - 6);
    ctx.setLineDash([Math.max(3, bounds.size * 0.16), Math.max(3, bounds.size * 0.12)]);
    ctx.strokeStyle = "rgba(255, 209, 102, 0.86)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bounds.x + 3, bounds.y + 3, bounds.size - 6, bounds.size - 6);
    ctx.setLineDash([]);
  }

  if (selected) {
    ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
    ctx.shadowBlur = 12;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2, bounds.size * 0.12);
    ctx.strokeRect(bounds.x + 1, bounds.y + 1, bounds.size - 2, bounds.size - 2);
  }
  ctx.restore();
}

function drawFrontierEdge(edge, color, width) {
  const [coord, direction] = edge.split(":");
  const { x, y } = parseCoord(coord);
  const bounds = cellBounds(x, y);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "square";
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  if (direction === "N") {
    ctx.moveTo(bounds.x, bounds.y);
    ctx.lineTo(bounds.x + bounds.size, bounds.y);
  } else if (direction === "E") {
    ctx.moveTo(bounds.x + bounds.size, bounds.y);
    ctx.lineTo(bounds.x + bounds.size, bounds.y + bounds.size);
  } else if (direction === "S") {
    ctx.moveTo(bounds.x, bounds.y + bounds.size);
    ctx.lineTo(bounds.x + bounds.size, bounds.y + bounds.size);
  } else {
    ctx.moveTo(bounds.x, bounds.y);
    ctx.lineTo(bounds.x, bounds.y + bounds.size);
  }
  ctx.stroke();
  ctx.restore();
}

function cellBounds(x, y) {
  return {
    x: drawInfo.offsetX + (x + drawInfo.span) * drawInfo.cell,
    y: drawInfo.offsetY + (drawInfo.span - y) * drawInfo.cell,
    size: drawInfo.cell,
  };
}

function canvasEventToChunk(event) {
  const rect = canvas.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const x = Math.floor((px - drawInfo.offsetX) / drawInfo.cell - drawInfo.span);
  const y = Math.floor(drawInfo.span - (py - drawInfo.offsetY) / drawInfo.cell);
  if (x < -drawInfo.span || x > drawInfo.span || y < -drawInfo.span || y > drawInfo.span) return null;
  return { x, y };
}

function getSelectedStatus(x, y) {
  if (isUnlocked(x, y, worldState.chunks)) return "unlocked";
  if (isCandidate(x, y, worldState.chunks)) return "candidate";
  return "locked";
}

function decodeCurrentSeed() {
  const seed = els.contourSeedInput.value.trim() || candidate?.seed || metrics.contourSeed;
  try {
    decodedEdges = decodeShapeSeed(seed);
  } catch (_error) {
    decodedEdges = [];
    els.selectionMessage.textContent = t("proofOfFrontier.messages.invalidSeed");
    renderCanvas();
    return;
  }
  decodedFlashUntil = performance.now() + 1800;
  els.contourPath.textContent = describeContourPath(decodedEdges);
  els.selectionMessage.textContent = t("proofOfFrontier.messages.decoded", { count: decodedEdges.length });
  renderCanvas();
}

function setSeedStatus(key, className = "") {
  els.seedMiningStatus.textContent = t(key);
  els.seedMiningStatus.className = className;
}

function statusKeyForCandidate(value) {
  if (!value) return "proofOfFrontier.status.idle";
  if (value.isValid) return "proofOfFrontier.status.valid";
  if (!value.isRootValid) return "proofOfFrontier.status.rootMismatch";
  if (!value.isCanonical) return "proofOfFrontier.status.nonCanonical";
  return "proofOfFrontier.status.seedTooLong";
}

function chooseVisibleCandidate(current, next) {
  if (!current) return next;
  if (next.isRootValid && !current.isRootValid) return next;
  if (next.isCanonical && !current.isCanonical) return next;
  if (next.byteLength < current.byteLength) return next;
  return current;
}

function setActiveStep(step) {
  els.steps.forEach((element) => element.classList.toggle("active", Number(element.dataset.step) === step));
}

function setControls() {
  els.startSearchButton.disabled = isSearching || isAutoRunning;
  els.searchOneButton.disabled = isSearching || isAutoRunning;
  els.submitCandidateButton.disabled = !candidate || isSearching || isAutoRunning;
  els.autoRunButton.disabled = isSearching || isAutoRunning;
  els.autoSolveButton.disabled = isSearching || isAutoRunning;
  els.stopButton.disabled = !isSearching && !isAutoRunning;
}

function computeBlockReward(seedBytes, maxSeedBytes) {
  const bonus = Math.max(0, maxSeedBytes - seedBytes) * 0.15;
  return Number((10 + bonus).toFixed(2));
}

function boolLabel(value) {
  return value ? t("proofOfFrontier.common.yes") : t("proofOfFrontier.common.no");
}

function averageBlockIntervalMs() {
  if (blockSolvedTimes.length < 2) return 0;
  const intervals = [];
  for (let index = 1; index < blockSolvedTimes.length; index += 1) intervals.push(blockSolvedTimes[index] - blockSolvedTimes[index - 1]);
  return intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
}

function exportDemoState() {
  return {
    epoch: currentEpoch,
    targetFrontierRoot: metrics.frontierRoot,
    difficulty,
    candidate,
    bestAcceptedSeedBytes,
    lastCalculationCount,
    currentEpochCalculationCount,
    unlockedCount: metrics.unlockedCount,
    perimeter: metrics.perimeter,
  };
}

async function copyText(value, messageKey) {
  try {
    await navigator.clipboard.writeText(value);
    els.selectionMessage.textContent = t(messageKey);
  } catch (_error) {
    els.selectionMessage.textContent = t("proofOfFrontier.messages.copyFailed");
  }
}

function parseCoord(coord) {
  const [x, y] = coord.split(",").map((value) => Number(value));
  return { x, y };
}

function formatEventValue(value) {
  if (typeof value === "number" && value > 1_000_000_000_000) return new Date(value).toLocaleTimeString();
  if (typeof value === "string" && value.length > 24) return shortHash(value, 10, 8);
  return String(value);
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
