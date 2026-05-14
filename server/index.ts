import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";
import { createServer as createViteServer } from "vite";
import { generateRoundSetupAsync, targetKey } from "../src/game/roundGenerator";
import { applyMoves, validateSubmission } from "../src/game/rules";
import {
  ClientMessage,
  GameResult,
  Move,
  Player,
  PublicRoomState,
  RobotPositions,
  RoomState,
  RoundResult,
  ServerMessage,
  Submission,
  ValidSubmission
} from "../src/game/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 5173);
const totalRounds = 10;
const roundTimeSeconds = 150;
const maxPlayers = 10;
const maxRooms = 500;
const roomIdleTimeoutMs = 30 * 60 * 1000;
const emptyRoomGraceMs = 5 * 60 * 1000;
const roomSweepIntervalMs = 60 * 1000;
const messagesPerSecondLimit = 20;

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon"
};

const compressibleTypes = new Set([".html", ".js", ".css", ".json", ".svg", ".ico"]);

type StaticEntry = {
  body: Buffer;
  gzip?: Buffer;
  br?: Buffer;
  contentType: string;
  cacheControl: string;
  etag: string;
};

const staticCache = new Map<string, StaticEntry>();

function pickEncoding(acceptEncoding: string | undefined, entry: StaticEntry): { body: Buffer; encoding?: string } {
  const accept = acceptEncoding ?? "";
  if (entry.br && /\bbr\b/.test(accept)) return { body: entry.br, encoding: "br" };
  if (entry.gzip && /\bgzip\b/.test(accept)) return { body: entry.gzip, encoding: "gzip" };
  return { body: entry.body };
}

function makeEtag(body: Buffer): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of body) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * prime);
  }
  return `"${body.length.toString(36)}-${hash.toString(36)}"`;
}

async function loadStaticEntry(filePath: string, urlPath: string): Promise<StaticEntry> {
  const body = await readFile(filePath);
  const ext = path.extname(filePath);
  const contentType = contentTypes[ext] ?? "application/octet-stream";
  const isHashedAsset = urlPath.startsWith("/assets/");
  const cacheControl = isHashedAsset
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";

  const entry: StaticEntry = {
    body,
    contentType,
    cacheControl,
    etag: makeEtag(body)
  };

  if (compressibleTypes.has(ext) && body.length >= 512) {
    entry.gzip = gzipSync(body, { level: 9 });
    entry.br = brotliCompressSync(body, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.length
      }
    });
  }

  return entry;
}

type ClientContext = {
  ws: WebSocket;
  roomId?: string;
  playerId?: string;
  rateWindowStart: number;
  rateCount: number;
  isAlive: boolean;
};

const heartbeatIntervalMs = 30 * 1000;

type ManagedRoom = RoomState & {
  sockets: Map<string, WebSocket>;
  roundTimer?: NodeJS.Timeout;
  lastRoundResult?: RoundResult;
  gameResult?: GameResult;
  isStartingRound?: boolean;
  nextInitialRobots?: RobotPositions;
  usedTargetKeys?: string[];
  lastActivityAt: number;
  emptySince?: number;
};
type RoundSetup = Awaited<ReturnType<typeof generateRoundSetupAsync>>;

const rooms = new Map<string, ManagedRoom>();
const clients = new WeakMap<WebSocket, ClientContext>();

function touchRoom(room: ManagedRoom): void {
  room.lastActivityAt = Date.now();
  const hasConnected = room.players.some((player) => player.connected);
  room.emptySince = hasConnected ? undefined : room.emptySince ?? Date.now();
}

function destroyRoom(room: ManagedRoom): void {
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = undefined;
  }
  for (const ws of room.sockets.values()) {
    const context = clients.get(ws);
    if (context) {
      context.roomId = undefined;
      context.playerId = undefined;
    }
  }
  room.sockets.clear();
  rooms.delete(room.roomId);
}

function sweepRooms(): void {
  const now = Date.now();
  for (const room of rooms.values()) {
    const idleFor = now - room.lastActivityAt;
    const emptyFor = room.emptySince ? now - room.emptySince : 0;
    if (emptyFor > emptyRoomGraceMs || idleFor > roomIdleTimeoutMs) {
      destroyRoom(room);
    }
  }
}
async function takeRoundSetup(room: ManagedRoom): Promise<RoundSetup> {
  touchRoom(room);
  return generateRoundSetupAsync({
    initialRobots: room.nextInitialRobots,
    usedTargetKeys: room.usedTargetKeys
  });
}

function randomId(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function uniqueRoomId(): string {
  let roomId = randomId(4);
  while (rooms.has(roomId)) roomId = randomId(4);
  return roomId;
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function publicState(room: ManagedRoom): PublicRoomState {
  return {
    roomId: room.roomId,
    phase: room.phase,
    players: room.players,
    totalRounds: room.totalRounds,
    roundTimeSeconds: room.roundTimeSeconds,
    lastRoundResult: room.lastRoundResult,
    gameResult: room.gameResult,
    currentRound: room.currentRound
      ? {
          roundNumber: room.currentRound.roundNumber,
          board: room.currentRound.board,
          initialRobots: room.currentRound.initialRobots,
          target: room.currentRound.target,
          deadline: room.currentRound.deadline,
          submissionSummary: {
            submittedPlayerIds: room.currentRound.submissions.map((submission) => submission.playerId)
          }
        }
      : undefined
  };
}

function broadcast(room: ManagedRoom): void {
  const state = publicState(room);
  for (const ws of room.sockets.values()) {
    send(ws, { type: "roomState", state });
  }
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed || `プレイヤー${randomId(2)}`;
}

function attachPlayer(room: ManagedRoom, ws: WebSocket, playerId: string, name: string): Player {
  let player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    player = { id: playerId, name: normalizeName(name), score: 0, connected: true };
    room.players.push(player);
  } else {
    player.name = normalizeName(name || player.name);
    player.connected = true;
  }
  room.sockets.set(player.id, ws);
  const existing = clients.get(ws);
  clients.set(ws, {
    ws,
    roomId: room.roomId,
    playerId: player.id,
    rateWindowStart: existing?.rateWindowStart ?? Date.now(),
    rateCount: existing?.rateCount ?? 0,
    isAlive: existing?.isAlive ?? true
  });
  touchRoom(room);
  return player;
}

function createRoom(ws: WebSocket, name: string, requestedPlayerId?: string): void {
  if (rooms.size >= maxRooms) {
    sweepRooms();
  }
  if (rooms.size >= maxRooms) {
    send(ws, { type: "error", message: "現在は新しい部屋を作れません。しばらくしてからお試しください。" });
    return;
  }
  const roomId = uniqueRoomId();
  const playerId = requestedPlayerId || randomId(12);
  const room: ManagedRoom = {
    roomId,
    phase: "waiting",
    players: [],
    totalRounds,
    roundTimeSeconds,
    sockets: new Map(),
    lastActivityAt: Date.now()
  };
  rooms.set(roomId, room);
  attachPlayer(room, ws, playerId, name);
  touchRoom(room);
  send(ws, { type: "roomCreated", roomId, playerId, state: publicState(room) });
  broadcast(room);
}

function joinRoom(ws: WebSocket, roomId: string, name: string, requestedPlayerId?: string): void {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) {
    send(ws, { type: "error", message: "部屋が見つかりません。" });
    return;
  }
  const returning = requestedPlayerId ? room.players.some((player) => player.id === requestedPlayerId) : false;
  if (room.phase !== "waiting" && !returning) {
    send(ws, { type: "error", message: "ゲームはすでに開始されています。" });
    return;
  }
  if (!returning && room.players.length >= maxPlayers) {
    send(ws, { type: "error", message: "部屋が満員です。" });
    return;
  }

  const playerId = requestedPlayerId || randomId(12);
  attachPlayer(room, ws, playerId, name);
  touchRoom(room);
  send(ws, { type: "joinedRoom", playerId, state: publicState(room) });
  broadcast(room);
}

async function startRound(room: ManagedRoom, roundNumber: number): Promise<void> {
  if (room.isStartingRound) return;
  room.isStartingRound = true;
  let setup: RoundSetup;
  try {
    setup = await takeRoundSetup(room);
  } finally {
    room.isStartingRound = false;
  }
  if (!rooms.has(room.roomId) || (room.phase !== "waiting" && room.phase !== "roundResult")) return;

  const startedAt = Date.now();
  room.phase = "playing";
  room.lastRoundResult = undefined;
  room.currentRound = {
    roundNumber,
    board: setup.board,
    initialRobots: setup.initialRobots,
    target: setup.target,
    startedAt,
    deadline: startedAt + room.roundTimeSeconds * 1000,
    submissions: []
  };
  room.usedTargetKeys = [...(room.usedTargetKeys ?? []), targetKey(setup.target)];
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => finishRound(room), room.roundTimeSeconds * 1000 + 250);
  touchRoom(room);
  broadcast(room);
}

function startGame(room: ManagedRoom): void {
  if (room.phase !== "waiting") return;
  if (room.players.length < 1) return;
  room.players.forEach((player) => {
    player.score = 0;
  });
  room.nextInitialRobots = undefined;
  room.usedTargetKeys = [];
  room.gameResult = undefined;
  room.lastRoundResult = undefined;
  void startRound(room, 1);
}

function toValidSubmission(round: NonNullable<RoomState["currentRound"]>, submission: Submission): ValidSubmission | null {
  const validation = validateSubmission(round.board, round.initialRobots, round.target, submission.moves);
  if (!validation.valid) return null;
  return {
    playerId: submission.playerId,
    moves: submission.moves,
    moveCount: submission.moves.length,
    submittedAt: submission.submittedAt
  };
}

function finishRound(room: ManagedRoom): void {
  if (room.phase !== "playing" || !room.currentRound) return;
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = undefined;
  }

  const round = room.currentRound;
  const validSubmissions = round.submissions
    .map((submission) => toValidSubmission(round, submission))
    .filter((submission): submission is ValidSubmission => Boolean(submission))
    .sort((a, b) => a.moveCount - b.moveCount || a.submittedAt - b.submittedAt);

  const winningSubmission = validSubmissions[0];
  if (winningSubmission) {
    const winner = room.players.find((player) => player.id === winningSubmission.playerId);
    if (winner) winner.score += 1;
  }
  room.nextInitialRobots = winningSubmission
    ? applyMoves(round.board, round.initialRobots, winningSubmission.moves) ?? round.initialRobots
    : round.initialRobots;

  const scores = Object.fromEntries(room.players.map((player) => [player.id, player.score]));
  const result: RoundResult = {
    roundNumber: round.roundNumber,
    winnerPlayerId: winningSubmission?.playerId,
    winningSubmission,
    validSubmissions,
    scores
  };

  room.phase = round.roundNumber >= room.totalRounds ? "gameResult" : "roundResult";
  room.lastRoundResult = result;

  for (const ws of room.sockets.values()) {
    send(ws, { type: "roundResult", result });
  }

  if (room.phase === "gameResult") {
    const highScore = Math.max(...room.players.map((player) => player.score));
    room.gameResult = {
      players: room.players,
      winners: room.players.filter((player) => player.score === highScore)
    };
    for (const ws of room.sockets.values()) {
      send(ws, { type: "gameResult", result: room.gameResult });
    }
  }

  broadcast(room);
}

function submitSolution(room: ManagedRoom, playerId: string, moves: Move[], ws: WebSocket): void {
  const round = room.currentRound;
  if (room.phase !== "playing" || !round) {
    send(ws, { type: "submissionRejected", reason: "現在ラウンド中ではありません。" });
    return;
  }
  if (Date.now() > round.deadline) {
    send(ws, { type: "submissionRejected", reason: "制限時間を過ぎています。" });
    return;
  }
  const validation = validateSubmission(round.board, round.initialRobots, round.target, moves);
  if (!validation.valid) {
    send(ws, { type: "submissionRejected", reason: validation.reason });
    return;
  }

  const submittedAt = Date.now();
  const existing = round.submissions.find((submission) => submission.playerId === playerId);
  if (!existing) {
    round.submissions.push({ playerId, moves, submittedAt });
  } else if (moves.length < existing.moves.length) {
    existing.moves = moves;
    existing.submittedAt = submittedAt;
  } else {
    send(ws, { type: "submissionRejected", reason: "すでに同じかより短い手順が記録されています。" });
    return;
  }

  touchRoom(room);
  send(ws, { type: "submissionAccepted", moveCount: moves.length });
  broadcast(room);
}

function leaveRoom(room: ManagedRoom, playerId: string, ws: WebSocket): void {
  room.sockets.delete(playerId);
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (player) player.connected = false;
  const existing = clients.get(ws);
  clients.set(ws, {
    ws,
    rateWindowStart: existing?.rateWindowStart ?? Date.now(),
    rateCount: existing?.rateCount ?? 0,
    isAlive: existing?.isAlive ?? true
  });
  touchRoom(room);
  send(ws, { type: "leftRoom" });
  broadcast(room);
}

function isRateLimited(ws: WebSocket): boolean {
  const context = clients.get(ws);
  if (!context) return false;
  const now = Date.now();
  if (now - context.rateWindowStart >= 1000) {
    context.rateWindowStart = now;
    context.rateCount = 0;
  }
  context.rateCount += 1;
  return context.rateCount > messagesPerSecondLimit;
}

function handleClientMessage(ws: WebSocket, raw: string): void {
  if (raw.length > 16 * 1024) {
    send(ws, { type: "error", message: "通信データが大きすぎます。" });
    return;
  }
  if (isRateLimited(ws)) {
    send(ws, { type: "error", message: "操作が速すぎます。少し待ってからお試しください。" });
    return;
  }

  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    send(ws, { type: "error", message: "通信データの形式が正しくありません。" });
    return;
  }

  const context = clients.get(ws);
  const room = context?.roomId ? rooms.get(context.roomId) : undefined;

  if (message.type === "createRoom") {
    createRoom(ws, message.name, message.playerId);
    return;
  }
  if (message.type === "joinRoom") {
    joinRoom(ws, message.roomId, message.name, message.playerId);
    return;
  }
  if (!room || !context?.playerId) {
    send(ws, { type: "error", message: "先に部屋へ参加してください。" });
    return;
  }
  if (message.type === "startGame") startGame(room);
  if (message.type === "forceEndRound") finishRound(room);
  if (message.type === "submitSolution") submitSolution(room, context.playerId, message.moves, ws);
  if (message.type === "nextRound" && room.phase === "roundResult" && room.currentRound) {
    void startRound(room, room.currentRound.roundNumber + 1);
  }
  if (message.type === "leaveRoom") {
    leaveRoom(room, context.playerId, ws);
  }
}

function handleDisconnect(ws: WebSocket): void {
  const context = clients.get(ws);
  if (!context?.roomId || !context.playerId) return;
  const room = rooms.get(context.roomId);
  if (!room) return;

  room.sockets.delete(context.playerId);
  const player = room.players.find((candidate) => candidate.id === context.playerId);
  if (player) player.connected = false;
  touchRoom(room);
  broadcast(room);
}

const vite = isProduction
  ? undefined
  : await createViteServer({
      server: { middlewareMode: true },
      appType: "custom"
    });

const server = createServer(async (req, res) => {
  if (!req.url) return;

  if (vite) {
    vite.middlewares(req, res, async () => {
      try {
        const template = await readFile(path.join(root, "index.html"), "utf-8");
        const html = await vite.transformIndexHtml(req.url ?? "/", template);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html");
        res.end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        res.statusCode = 500;
        res.end((error as Error).message);
      }
    });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const urlPath = requestUrl.pathname === "/" || requestUrl.pathname.startsWith("/room/")
    ? "/index.html"
    : requestUrl.pathname;
  const distRoot = path.join(root, "dist");
  const filePath = path.normalize(path.join(distRoot, urlPath));
  if (!filePath.startsWith(distRoot)) {
    res.statusCode = 404;
    res.end("見つかりません");
    return;
  }

  let entry = staticCache.get(filePath);
  if (!entry) {
    try {
      entry = await loadStaticEntry(filePath, urlPath);
      staticCache.set(filePath, entry);
    } catch {
      res.statusCode = 404;
      res.end("見つかりません");
      return;
    }
  }

  if (req.headers["if-none-match"] === entry.etag) {
    res.statusCode = 304;
    res.setHeader("ETag", entry.etag);
    res.setHeader("Cache-Control", entry.cacheControl);
    res.end();
    return;
  }

  const picked = pickEncoding(req.headers["accept-encoding"]?.toString(), entry);
  res.setHeader("Content-Type", entry.contentType);
  res.setHeader("Cache-Control", entry.cacheControl);
  res.setHeader("ETag", entry.etag);
  res.setHeader("Vary", "Accept-Encoding");
  if (picked.encoding) res.setHeader("Content-Encoding", picked.encoding);
  res.setHeader("Content-Length", picked.body.length);
  res.end(picked.body);
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
wss.on("connection", (ws) => {
  clients.set(ws, { ws, rateWindowStart: Date.now(), rateCount: 0, isAlive: true });
  ws.on("message", (data) => handleClientMessage(ws, data.toString()));
  ws.on("close", () => handleDisconnect(ws));
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
  ws.on("pong", () => {
    const context = clients.get(ws);
    if (context) context.isAlive = true;
  });
});

wss.on("error", (error) => {
  console.error("WebSocketServer error:", error);
});

const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    const context = clients.get(ws);
    if (!context) {
      ws.terminate();
      continue;
    }
    if (!context.isAlive) {
      ws.terminate();
      continue;
    }
    context.isAlive = false;
    try {
      ws.ping();
    } catch (error) {
      console.error("WebSocket ping failed:", error);
      ws.terminate();
    }
  }
}, heartbeatIntervalMs);
heartbeatTimer.unref();

wss.on("close", () => {
  clearInterval(heartbeatTimer);
});

process.on("uncaughtException", (error) => {
  console.error("uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});

server.on("clientError", (error, socket) => {
  console.error("HTTP clientError:", error);
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } else {
    socket.destroy();
  }
});

setInterval(sweepRooms, roomSweepIntervalMs).unref();

server.listen(port, "0.0.0.0", () => {
  console.log(`Slide Bots running at http://localhost:${port}`);
});
