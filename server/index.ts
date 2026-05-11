import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { createServer as createViteServer } from "vite";
import { generateRoundSetup } from "../src/game/roundGenerator";
import { validateSubmission } from "../src/game/rules";
import {
  ClientMessage,
  GameResult,
  Move,
  Player,
  PublicRoomState,
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
  ".ico": "image/x-icon"
};

type ClientContext = {
  ws: WebSocket;
  roomId?: string;
  playerId?: string;
};

type ManagedRoom = RoomState & {
  sockets: Map<string, WebSocket>;
  roundTimer?: NodeJS.Timeout;
  lastRoundResult?: RoundResult;
  gameResult?: GameResult;
  preparedRoundSetup?: RoundSetup;
  isPreparingRoundSetup?: boolean;
};
type RoundSetup = ReturnType<typeof generateRoundSetup>;

const rooms = new Map<string, ManagedRoom>();
const clients = new WeakMap<WebSocket, ClientContext>();
const warmRoundSetups: RoundSetup[] = [];
let isWarmingRoundSetup = false;

function warmRoundSetup(): void {
  if (isWarmingRoundSetup || warmRoundSetups.length >= 2) return;
  isWarmingRoundSetup = true;
  setTimeout(() => {
    try {
      warmRoundSetups.push(generateRoundSetup());
    } finally {
      isWarmingRoundSetup = false;
      if (warmRoundSetups.length < 2) warmRoundSetup();
    }
  }, 500);
}

function prepareRoomRoundSetup(room: ManagedRoom): void {
  if (room.preparedRoundSetup || room.isPreparingRoundSetup) return;
  room.isPreparingRoundSetup = true;
  setTimeout(() => {
    try {
      room.preparedRoundSetup = generateRoundSetup();
    } finally {
      room.isPreparingRoundSetup = false;
    }
  }, 0);
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
  clients.set(ws, { ws, roomId: room.roomId, playerId: player.id });
  return player;
}

function createRoom(ws: WebSocket, name: string, requestedPlayerId?: string): void {
  const roomId = uniqueRoomId();
  const playerId = requestedPlayerId || randomId(12);
  const room: ManagedRoom = {
    roomId,
    phase: "waiting",
    players: [],
    totalRounds,
    roundTimeSeconds,
    sockets: new Map()
  };
  rooms.set(roomId, room);
  attachPlayer(room, ws, playerId, name);
  prepareRoomRoundSetup(room);
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
  prepareRoomRoundSetup(room);
  send(ws, { type: "joinedRoom", playerId, state: publicState(room) });
  broadcast(room);
}

function startRound(room: ManagedRoom, roundNumber: number): void {
  const setup = room.preparedRoundSetup ?? warmRoundSetups.shift() ?? generateRoundSetup();
  room.preparedRoundSetup = undefined;
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
  if (room.roundTimer) clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => finishRound(room), room.roundTimeSeconds * 1000 + 250);
  broadcast(room);
  prepareRoomRoundSetup(room);
  warmRoundSetup();
}

function startGame(room: ManagedRoom): void {
  if (room.phase !== "waiting") return;
  if (room.players.length < 1) return;
  room.players.forEach((player) => {
    player.score = 0;
  });
  startRound(room, 1);
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

  send(ws, { type: "submissionAccepted", moveCount: moves.length });
  broadcast(room);
}

function leaveRoom(room: ManagedRoom, playerId: string, ws: WebSocket): void {
  room.sockets.delete(playerId);
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (player) player.connected = false;
  clients.set(ws, { ws });
  send(ws, { type: "leftRoom" });
  broadcast(room);
}

function handleClientMessage(ws: WebSocket, raw: string): void {
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
    startRound(room, room.currentRound.roundNumber + 1);
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
  try {
    const filePath = path.join(root, "dist", urlPath);
    const body = await readFile(filePath);
    res.setHeader("Content-Type", contentTypes[path.extname(filePath)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("見つかりません");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.set(ws, { ws });
  ws.on("message", (data) => handleClientMessage(ws, data.toString()));
  ws.on("close", () => handleDisconnect(ws));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Slide Bots running at http://localhost:${port}`);
});
