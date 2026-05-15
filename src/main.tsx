import React from "react";
import { createRoot } from "react-dom/client";
import { RotateCcw, Undo2, Copy, Play, Send, StepForward, Flag, LogOut, Loader2 } from "lucide-react";
import { fixedBoard } from "./game/boards/fixedBoard";
import { allPieceImages, pieceImageFor } from "./game/pieceAssets";
import { applyMove, detectSwipeDirection, isGoalReached, robotAt, sameCell } from "./game/rules";
import { allTargetImages, targetImageFor } from "./game/targetAssets";
import { Board, ClientMessage, Move, PublicRoomState, RobotColor, RobotPositions, RoundResult, ServerMessage, Target, TargetColor, robotColors } from "./game/types";
import "./styles.css";

type LocalPlayState = {
  robots: RobotPositions;
  moveHistory: Move[];
  submittedMoveCount?: number;
};

type RobotRenderPositions = Record<RobotColor, { x: number; y: number }>;
type LobbyPendingAction = "create" | "join" | null;
type AcceptedSubmission = {
  moveCount: number;
  receivedAt: number;
};

type AssetLoadState = "loading" | "ready" | "fallback";

const gameImageUrls = Array.from(new Set([...allPieceImages, ...allTargetImages]));
const finalMinuteMs = 60 * 1000;

const colorName: Record<TargetColor, string> = {
  red: "赤",
  blue: "青",
  green: "緑",
  yellow: "黄",
  rainbow: "虹"
};

function useNow(intervalMs = 250): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useGameImageAssets(): AssetLoadState {
  const [assetState, setAssetState] = React.useState<AssetLoadState>("loading");

  React.useEffect(() => {
    let cancelled = false;

    Promise.all(
      gameImageUrls.map(
        (url) =>
          new Promise<boolean>((resolve) => {
            const image = new Image();
            image.decoding = "async";
            image.onload = () => resolve(true);
            image.onerror = () => resolve(false);
            image.src = url;
            if (image.complete) resolve(image.naturalWidth > 0);
          })
      )
    ).then((results) => {
      if (cancelled) return;
      setAssetState(results.every(Boolean) ? "ready" : "fallback");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return assetState;
}

function cloneRobotPositions(robots: RobotPositions): RobotRenderPositions {
  return Object.fromEntries(robotColors.map((color) => [color, { ...robots[color] }])) as RobotRenderPositions;
}

function robotPositionsKey(robots: RobotPositions): string {
  return robotColors.map((color) => `${robots[color].x},${robots[color].y}`).join("|");
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function wsUrl(): string {
  if (import.meta.env.PROD) {
    return `wss://${window.location.host}/ws`;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function sendJson(ws: WebSocket | null, message: ClientMessage): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function isSocketOpen(ws: WebSocket | null): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <>
      <Loader2 className="spin" size={16} /> {label}
    </>
  );
}

function roomIdFromLocation(): string {
  const match = window.location.pathname.match(/^\/room\/([A-Z0-9]{4})$/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function savedRoomId(): string {
  return roomIdFromLocation() || localStorage.getItem("slideBots.roomId") || "";
}

function displayPlayerName(name: string): string {
  return name.replace(/^Player ([A-Z0-9]{2})$/, "プレイヤー$1");
}

function useSocket() {
  const [ws, setWs] = React.useState<WebSocket | null>(null);
  const [socketReady, setSocketReady] = React.useState(false);
  const [state, setState] = React.useState<PublicRoomState | null>(null);
  const [playerId, setPlayerId] = React.useState(localStorage.getItem("slideBots.playerId") ?? "");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [acceptedSubmission, setAcceptedSubmission] = React.useState<AcceptedSubmission | null>(null);

  React.useEffect(() => {
    const socket = new WebSocket(wsUrl());
    setWs(socket);

    socket.addEventListener("open", () => {
      setSocketReady(true);
      const savedPlayerId = localStorage.getItem("slideBots.playerId") ?? "";
      const roomId = savedRoomId();
      if (!savedPlayerId || !roomId) return;

      sendJson(socket, {
        type: "joinRoom",
        roomId,
        name: localStorage.getItem("slideBots.name") ?? "",
        playerId: savedPlayerId
      });
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "roomCreated" || message.type === "joinedRoom") {
        setPlayerId(message.playerId);
        localStorage.setItem("slideBots.playerId", message.playerId);
        localStorage.setItem("slideBots.roomId", message.state.roomId);
        window.history.replaceState(null, "", `/room/${message.state.roomId}`);
        setState(message.state);
        setError("");
      }
      if (message.type === "roomState") setState(message.state);
      if (message.type === "submissionAccepted") {
        setNotice(`${message.moveCount}手で送信しました。`);
        setAcceptedSubmission({ moveCount: message.moveCount, receivedAt: Date.now() });
        setError("");
      }
      if (message.type === "submissionRejected") {
        setError(message.reason);
      }
      if (message.type === "roundResult") {
        setNotice("ラウンド終了。");
      }
      if (message.type === "gameResult") {
        setNotice("ゲーム終了。");
      }
      if (message.type === "leftRoom") {
        localStorage.removeItem("slideBots.roomId");
        window.history.replaceState(null, "", "/");
        setState(null);
        setNotice("初期画面に戻りました。");
      }
      if (message.type === "error") {
        setError(message.message);
      }
    });

    socket.addEventListener("close", () => {
      setSocketReady(false);
      setNotice("接続が切れました。再接続するには更新してください。");
    });
    return () => socket.close();
  }, []);

  React.useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(id);
  }, [notice]);

  React.useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(id);
  }, [error]);

  return { ws, socketReady, state, setState, playerId, error, setError, notice, setNotice, acceptedSubmission };
}

function targetGlyph(target: Target): string {
  if (target.shape === "circle") return "●";
  if (target.shape === "triangle") return "▲";
  if (target.shape === "square") return "■";
  if (target.shape === "cross") return "×";
  return "◎";
}

function targetLabel(target: Target): string {
  return `${colorName[target.color]} ${targetGlyph(target)}`;
}

type TargetImageMetrics = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const targetImageMetrics: Record<string, TargetImageMetrics> = {
  "rainbow-vortex": { left: 47, top: 42, width: 418, height: 428 },
  "blue-circle": { left: 94, top: 130, width: 325, height: 340 },
  "blue-square": { left: 74, top: 42, width: 365, height: 428 },
  "blue-cross": { left: 47, top: 42, width: 418, height: 428 },
  "blue-triangle": { left: 42, top: 64, width: 428, height: 385 },
  "green-circle": { left: 58, top: 42, width: 396, height: 428 },
  "green-square": { left: 56, top: 42, width: 401, height: 428 },
  "green-cross": { left: 52, top: 42, width: 409, height: 428 },
  "green-triangle": { left: 42, top: 72, width: 428, height: 369 },
  "red-circle": { left: 44, top: 42, width: 424, height: 428 },
  "red-square": { left: 45, top: 42, width: 422, height: 428 },
  "red-cross": { left: 50, top: 42, width: 413, height: 428 },
  "red-triangle": { left: 42, top: 66, width: 428, height: 379 },
  "yellow-circle": { left: 54, top: 42, width: 405, height: 428 },
  "yellow-square": { left: 44, top: 42, width: 425, height: 428 },
  "yellow-cross": { left: 48, top: 42, width: 417, height: 428 },
  "yellow-triangle": { left: 42, top: 70, width: 428, height: 373 }
};

const targetImageSourceSize = 512;

function targetMetricsKey(target: Target): string {
  if (target.color === "rainbow" || target.shape === "vortex") return "rainbow-vortex";
  return `${target.color}-${target.shape}`;
}

function targetImageBox(target: Target, visibleSize: number) {
  const metrics = targetImageMetrics[targetMetricsKey(target)];
  const imageSize = (visibleSize * targetImageSourceSize) / Math.max(metrics.width, metrics.height);
  return {
    x: 0.5 - ((metrics.left + metrics.width / 2) / targetImageSourceSize) * imageSize,
    y: 0.5 - ((metrics.top + metrics.height / 2) / targetImageSourceSize) * imageSize,
    size: imageSize
  };
}

function targetMarkerStyle(target: Target): React.CSSProperties {
  const box = targetImageBox(target, 0.88);
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.size * 100}%`,
    height: `${box.size * 100}%`
  };
}

const fallbackColor: Record<TargetColor | RobotColor, string> = {
  red: "#d9423d",
  blue: "#246db7",
  green: "#2f9460",
  yellow: "#f0b82f",
  black: "#171c24",
  rainbow: "#7b55d9"
};

function FallbackTargetShape({ target, className = "" }: { target: Target; className?: string }) {
  const color = fallbackColor[target.color];
  if (target.shape === "triangle") return <polygon className={className} points="0.5,0.13 0.88,0.83 0.12,0.83" fill={color} />;
  if (target.shape === "square") return <rect className={className} x="0.18" y="0.18" width="0.64" height="0.64" fill={color} />;
  if (target.shape === "cross") {
    return (
      <path
        className={className}
        d="M0.42 0.13h0.16v0.29h0.29v0.16h-0.29v0.29h-0.16v-0.29h-0.29v-0.16h0.29z"
        fill={color}
      />
    );
  }
  if (target.shape === "vortex" || target.color === "rainbow") {
    return (
      <g className={className}>
        <circle cx="0.5" cy="0.5" r="0.34" fill="#ffffff" />
        <path d="M0.5 0.16a0.34 0.34 0 0 1 0.34 0.34h-0.22a0.12 0.12 0 0 0-0.12-0.12z" fill="#d9423d" />
        <path d="M0.84 0.5a0.34 0.34 0 0 1-0.34 0.34v-0.22a0.12 0.12 0 0 0 0.12-0.12z" fill="#246db7" />
        <path d="M0.5 0.84a0.34 0.34 0 0 1-0.34-0.34h0.22a0.12 0.12 0 0 0 0.12 0.12z" fill="#f0b82f" />
        <path d="M0.16 0.5a0.34 0.34 0 0 1 0.34-0.34v0.22a0.12 0.12 0 0 0-0.12 0.12z" fill="#2f9460" />
      </g>
    );
  }
  return <circle className={className} cx="0.5" cy="0.5" r="0.32" fill={color} />;
}

function GoalMarker({ target, useRasterAssets }: { target: Target; useRasterAssets: boolean }) {
  return (
    <span className="goal-marker-frame">
      {useRasterAssets ? (
        <img className="goal-marker" src={targetImageFor(target)} alt="" style={targetMarkerStyle(target)} />
      ) : (
        <svg className="goal-marker-fallback" viewBox="0 0 1 1" aria-hidden="true">
          <FallbackTargetShape target={target} />
        </svg>
      )}
    </span>
  );
}

function BoardView({
  board,
  robots,
  target,
  showActiveTarget,
  onMove,
  useRasterAssets
}: {
  board: Board;
  robots: RobotPositions;
  target: Target;
  showActiveTarget: boolean;
  onMove?: (robot: RobotColor, dx: number, dy: number) => void;
  useRasterAssets: boolean;
}) {
  const pointerStart = React.useRef<{ x: number; y: number; robot: RobotColor } | null>(null);
  const [displayRobots, setDisplayRobots] = React.useState<RobotRenderPositions>(() => cloneRobotPositions(robots));
  const displayRobotsRef = React.useRef(displayRobots);
  const robotsKey = robotPositionsKey(robots);

  React.useEffect(() => {
    displayRobotsRef.current = displayRobots;
  }, [displayRobots]);

  React.useEffect(() => {
    const from = displayRobotsRef.current;
    const to = cloneRobotPositions(robots);
    const maxDistance = Math.max(
      ...robotColors.map((color) => Math.hypot(to[color].x - from[color].x, to[color].y - from[color].y))
    );

    if (maxDistance === 0) return;

    const duration = Math.min(460, 170 + maxDistance * 28);
    const startedAt = performance.now();
    let frameId = 0;

    function tick(now: number): void {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = robotColors.reduce((positions, color) => {
        positions[color] = {
          x: from[color].x + (to[color].x - from[color].x) * eased,
          y: from[color].y + (to[color].y - from[color].y) * eased
        };
        return positions;
      }, {} as RobotRenderPositions);

      displayRobotsRef.current = next;
      setDisplayRobots(next);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        displayRobotsRef.current = to;
        setDisplayRobots(to);
      }
    }

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [robotsKey]);

  function pointerCell(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor(((event.clientX - rect.left) / rect.width) * board.width),
      y: Math.floor(((event.clientY - rect.top) / rect.height) * board.height)
    };
  }

  function pointerDown(event: React.PointerEvent<SVGSVGElement>): void {
    if (!onMove) return;
    const cell = pointerCell(event);
    const robot = robotAt(robots, cell);
    if (!robot) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = { x: event.clientX, y: event.clientY, robot };
  }

  function pointerUp(event: React.PointerEvent<SVGSVGElement>): void {
    if (!onMove || !pointerStart.current) return;
    const start = pointerStart.current;
    pointerStart.current = null;
    onMove(start.robot, event.clientX - start.x, event.clientY - start.y);
  }

  const cells = Array.from({ length: board.width * board.height }, (_, index) => ({
    x: index % board.width,
    y: Math.floor(index / board.width),
    wall: board.walls[index]
  }));

  return (
    <svg
      className="board"
      viewBox={`0 0 ${board.width} ${board.height}`}
      role="img"
      aria-label="16かける16のスライドボット盤面"
      onPointerDown={pointerDown}
      onPointerUp={pointerUp}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
    >
      <rect width={board.width} height={board.height} className="board-bg" />
      {cells.map((cell) => (
        <g key={`${cell.x}-${cell.y}`}>
          <rect x={cell.x} y={cell.y} width="1" height="1" className="cell" />
          {cell.wall & 1 ? <line x1={cell.x} y1={cell.y} x2={cell.x + 1} y2={cell.y} className="wall" /> : null}
          {cell.wall & 2 ? <line x1={cell.x + 1} y1={cell.y} x2={cell.x + 1} y2={cell.y + 1} className="wall" /> : null}
          {cell.wall & 4 ? <line x1={cell.x} y1={cell.y + 1} x2={cell.x + 1} y2={cell.y + 1} className="wall" /> : null}
          {cell.wall & 8 ? <line x1={cell.x} y1={cell.y} x2={cell.x} y2={cell.y + 1} className="wall" /> : null}
        </g>
      ))}
      {board.blocked.map((cell) => (
        <rect key={`blocked-${cell.x}-${cell.y}`} x={cell.x + 0.05} y={cell.y + 0.05} width="0.9" height="0.9" className="blocked" />
      ))}
      {board.targets.map((item) => {
        const box = targetImageBox(item, 0.86);
        const isActiveTarget = showActiveTarget && sameCell(item, target) && item.color === target.color && item.shape === target.shape;
        const className = isActiveTarget ? "target-image active-target" : "target-image";
        if (!useRasterAssets) {
          return (
            <g
              key={`target-${item.x}-${item.y}-${item.color}-${item.shape}`}
              transform={`translate(${item.x + box.x} ${item.y + box.y}) scale(${box.size})`}
              aria-label={targetLabel(item)}
            >
              <FallbackTargetShape target={item} className={className} />
            </g>
          );
        }
        return (
          <image
            key={`target-${item.x}-${item.y}-${item.color}-${item.shape}`}
            href={targetImageFor(item)}
            x={item.x + box.x}
            y={item.y + box.y}
            width={box.size}
            height={box.size}
            className={className}
            aria-label={targetLabel(item)}
            preserveAspectRatio="xMidYMid meet"
          />
        );
      })}
      {Object.entries(displayRobots).map(([color, cell]) => (
        <g key={color} className="robot-hit">
          {useRasterAssets ? (
            <image
              href={pieceImageFor(color as RobotColor)}
              x={cell.x + 0.07}
              y={cell.y + 0.07}
              width="0.86"
              height="0.86"
              className="robot-piece"
              aria-label={`${color} robot`}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : (
            <g className="robot-piece-fallback" aria-label={`${color} robot`}>
              <circle cx={cell.x + 0.5} cy={cell.y + 0.5} r="0.36" fill={fallbackColor[color as RobotColor]} />
              <circle cx={cell.x + 0.5} cy={cell.y + 0.5} r="0.16" fill="rgba(255,255,255,0.84)" />
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

function Lobby({ ws, socketReady, playerId, error }: { ws: WebSocket | null; socketReady: boolean; playerId: string; error: string }) {
  const [name, setName] = React.useState(localStorage.getItem("slideBots.name") ?? "");
  const [roomId, setRoomId] = React.useState(savedRoomId());
  const [pendingAction, setPendingAction] = React.useState<LobbyPendingAction>(null);
  const canSend = socketReady && isSocketOpen(ws);

  React.useEffect(() => {
    if (error) setPendingAction(null);
  }, [error]);

  React.useEffect(() => {
    if (!canSend) setPendingAction(null);
  }, [canSend]);

  function remember(): void {
    localStorage.setItem("slideBots.name", name);
  }

  return (
    <section className="join-panel">
      <div>
        <h1>Slide Bots</h1>
        <p>1から10人で同時に遊べるスライドパズルです。</p>
      </div>
      <label>
        名前
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="あなたの名前" />
      </label>
      <div className="join-actions">
        <button
          disabled={!canSend || pendingAction !== null}
          onClick={() => {
            remember();
            if (sendJson(ws, { type: "createRoom", name, playerId })) {
              setPendingAction("create");
            }
          }}
        >
          {pendingAction === "create" ? <LoadingLabel label="作成中..." /> : <><Play size={18} /> 部屋を作る</>}
        </button>
        <label>
          部屋コード
          <input value={roomId} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="ABCD" />
        </label>
        <button
          className="secondary"
          disabled={!canSend || pendingAction !== null}
          onClick={() => {
            remember();
            if (sendJson(ws, { type: "joinRoom", roomId, name, playerId })) {
              setPendingAction("join");
            }
          }}
        >
          {pendingAction === "join" ? <LoadingLabel label="参加中..." /> : "参加"}
        </button>
      </div>
      {!canSend ? (
        <div className="loading-status" role="status" aria-live="polite">
          <LoadingLabel label="接続中..." />
        </div>
      ) : null}
    </section>
  );
}

function PlayerList({ state }: { state: PublicRoomState }) {
  return (
    <section className="panel players">
      {state.players.map((player) => (
        <div className="player" key={player.id}>
          <span className={player.connected ? "dot online" : "dot"} />
          <span>{displayPlayerName(player.name)}</span>
          <strong>{player.score}</strong>
        </div>
      ))}
    </section>
  );
}

function GameControls({
  state,
  local,
  goalReached,
  onUndo,
  onReset,
  onSubmit,
  isSubmitting,
  useRasterAssets
}: {
  state: PublicRoomState;
  local: LocalPlayState | null;
  goalReached: boolean;
  onUndo: () => void;
  onReset: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  useRasterAssets: boolean;
}) {
  const now = useNow();
  const round = state.currentRound;
  const deadlineOpen = round ? now < round.deadline : false;
  const canSubmit = state.phase === "playing" && goalReached && Boolean(local?.moveHistory.length) && deadlineOpen;

  return (
    <section className="panel controls">
      <div className="goal-cell" aria-label={round ? `目標: ${targetLabel(round.target)}` : "待機中"}>
        {round ? (
          <GoalMarker target={round.target} useRasterAssets={useRasterAssets} />
        ) : (
          <strong>待機中</strong>
        )}
      </div>
      <div>
        <span className="eyebrow">手数</span>
        <strong>{local?.moveHistory.length ?? 0}</strong>
      </div>
      <div className="buttons">
        <button className="secondary icon" onClick={onUndo} disabled={!local?.moveHistory.length} title="1手戻す">
          <Undo2 size={18} />
        </button>
        <button className="secondary icon" onClick={onReset} disabled={!round} title="リセット">
          <RotateCcw size={18} />
        </button>
        <button onClick={onSubmit} disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? <LoadingLabel label="送信中..." /> : <><Send size={18} /> 送信</>}
        </button>
      </div>
      {local?.submittedMoveCount ? <span className="submitted">送信済み最短: {local.submittedMoveCount}手</span> : null}
    </section>
  );
}

function RoundResultView({
  result,
  state,
  ws,
  onShowGameResult
}: {
  result: RoundResult;
  state: PublicRoomState;
  ws: WebSocket | null;
  onShowGameResult?: () => void;
}) {
  const winner = state.players.find((player) => player.id === result.winnerPlayerId);
  const [isLoadingNext, setIsLoadingNext] = React.useState(false);

  React.useEffect(() => {
    setIsLoadingNext(false);
  }, [result.roundNumber]);

  return (
    <section className="panel result">
      <h2>第{result.roundNumber}ラウンド結果</h2>
      <p>{winner ? `${displayPlayerName(winner.name)}さんが${result.winningSubmission?.moveCount}手で勝利しました。` : "このラウンドの有効な回答はありませんでした。"}</p>
      <div className="submission-list">
        {result.validSubmissions.map((submission) => {
          const player = state.players.find((candidate) => candidate.id === submission.playerId);
          return (
            <span key={`${submission.playerId}-${submission.submittedAt}`}>
              {player ? displayPlayerName(player.name) : "プレイヤー"}: {submission.moveCount}手
            </span>
          );
        })}
      </div>
      {state.phase === "roundResult" ? (
        <button
          disabled={!isSocketOpen(ws) || isLoadingNext}
          onClick={() => {
            if (sendJson(ws, { type: "nextRound" })) {
              setIsLoadingNext(true);
            }
          }}
        >
          {isLoadingNext ? <LoadingLabel label="準備中..." /> : <><StepForward size={18} /> 次のラウンド</>}
        </button>
      ) : state.phase === "gameResult" && onShowGameResult ? (
        <button onClick={onShowGameResult}>
          <StepForward size={18} /> 最終結果へ
        </button>
      ) : null}
    </section>
  );
}

function GameResultView({ state }: { state: PublicRoomState }) {
  if (!state.gameResult) return null;
  return (
    <section className="panel result">
      <h2>最終結果</h2>
      <p>優勝: {state.gameResult.winners.map((winner) => displayPlayerName(winner.name)).join(", ")}</p>
      <div className="submission-list">
        {state.gameResult.players
          .slice()
          .sort((a, b) => b.score - a.score)
          .map((player) => (
            <span key={player.id}>
              {displayPlayerName(player.name)}: {player.score}点
            </span>
          ))}
      </div>
    </section>
  );
}

function Room({
  ws,
  socketReady,
  state,
  playerId,
  error,
  acceptedSubmission,
  assetState
}: {
  ws: WebSocket | null;
  socketReady: boolean;
  state: PublicRoomState;
  playerId: string;
  error: string;
  acceptedSubmission: AcceptedSubmission | null;
  assetState: AssetLoadState;
}) {
  const round = state.currentRound;
  const [local, setLocal] = React.useState<LocalPlayState | null>(null);
  const [isStarting, setIsStarting] = React.useState(false);
  const [isForcingRoundEnd, setIsForcingRoundEnd] = React.useState(false);
  const [isSubmittingSolution, setIsSubmittingSolution] = React.useState(false);
  const [isFinalResultOpen, setIsFinalResultOpen] = React.useState(false);
  const submitInFlightRef = React.useRef(false);
  const now = useNow();

  React.useEffect(() => {
    if (state.phase !== "waiting" || round) {
      setIsStarting(false);
    }
    if (state.phase !== "playing") {
      setIsForcingRoundEnd(false);
      setIsSubmittingSolution(false);
      submitInFlightRef.current = false;
    }
    if (!socketReady) {
      setIsStarting(false);
      setIsForcingRoundEnd(false);
      setIsSubmittingSolution(false);
      submitInFlightRef.current = false;
    }
  }, [round, socketReady, state.phase]);

  React.useEffect(() => {
    if (!error) return;
    setIsSubmittingSolution(false);
    submitInFlightRef.current = false;
  }, [error]);

  React.useEffect(() => {
    if (state.phase !== "gameResult") {
      setIsFinalResultOpen(false);
    }
  }, [state.phase]);

  React.useEffect(() => {
    if (!acceptedSubmission) return;
    setIsSubmittingSolution(false);
    submitInFlightRef.current = false;
    setLocal((current) => {
      if (!current) return current;
      const submittedMoveCount = current.submittedMoveCount
        ? Math.min(current.submittedMoveCount, acceptedSubmission.moveCount)
        : acceptedSubmission.moveCount;
      return { ...current, submittedMoveCount };
    });
  }, [acceptedSubmission?.receivedAt]);

  React.useEffect(() => {
    if (!round) {
      setLocal(null);
      return;
    }
    setLocal({
      robots: round.initialRobots,
      moveHistory: []
    });
  }, [round?.roundNumber, round?.startedAt]);

  const board = round?.board ?? fixedBoard;
  const target = round?.target ?? fixedBoard.targets[0];
  const robots = local?.robots ?? round?.initialRobots ?? {
    red: { x: 0, y: 0 },
    blue: { x: 2, y: 0 },
    green: { x: 4, y: 0 },
    yellow: { x: 6, y: 0 },
    black: { x: 8, y: 0 }
  };
  const goalReached = round ? isGoalReached(board, robots, target) : false;

  React.useEffect(() => {
    const result = state.lastRoundResult;
    const winningMoves = result?.winningSubmission?.moves;
    if (!round || !winningMoves || !["roundResult", "gameResult"].includes(state.phase)) return;

    let replayRobots = round.initialRobots;
    const timers: number[] = [];
    setLocal({ robots: replayRobots, moveHistory: [] });

    winningMoves.forEach((move, index) => {
      const timer = window.setTimeout(() => {
        const nextRobots = applyMove(round.board, replayRobots, move);
        if (nextRobots) replayRobots = nextRobots;
        setLocal({
          robots: replayRobots,
          moveHistory: winningMoves.slice(0, index + 1)
        });
      }, 520 * (index + 1));
      timers.push(timer);
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [round?.roundNumber, round?.startedAt, state.phase, state.lastRoundResult?.winningSubmission?.submittedAt]);

  function moveRobot(robot: RobotColor, dx: number, dy: number): void {
    if (!round || state.phase !== "playing") return;
    const direction = detectSwipeDirection(dx, dy);
    if (!direction) return;
    setLocal((current) => {
      if (!current) return current;
      const nextRobots = applyMove(board, current.robots, { robot, direction });
      if (!nextRobots || sameCell(nextRobots[robot], current.robots[robot])) return current;
      return {
        ...current,
        robots: nextRobots,
        moveHistory: [...current.moveHistory, { robot, direction }]
      };
    });
  }

  function undo(): void {
    if (!round) return;
    setLocal((current) => {
      if (!current || current.moveHistory.length === 0) return current;
      const moves = current.moveHistory.slice(0, -1);
      let robots = round.initialRobots;
      for (const move of moves) {
        const next = applyMove(board, robots, move);
        if (next) robots = next;
      }
      return { ...current, robots, moveHistory: moves };
    });
  }

  function reset(): void {
    if (!round) return;
    setLocal({ robots: round.initialRobots, moveHistory: [] });
  }

  function submit(): void {
    if (!local || isSubmittingSolution || submitInFlightRef.current) return;
    if (sendJson(ws, { type: "submitSolution", moves: local.moveHistory })) {
      submitInFlightRef.current = true;
      setIsSubmittingSolution(true);
    }
  }

  function startGame(): void {
    if (!isSocketOpen(ws)) return;
    if (sendJson(ws, { type: "startGame" })) {
      setIsStarting(true);
    }
  }

  function leaveToLobby(): void {
    if (!window.confirm("ゲームを終了して初期画面に戻りますか？")) return;
    sendJson(ws, { type: "leaveRoom" });
  }

  function forceEndRound(): void {
    if (!window.confirm("このラウンドを終了しますか？\n現在の最短提出が勝ちになります。")) return;
    if (sendJson(ws, { type: "forceEndRound" })) {
      setIsForcingRoundEnd(true);
    }
  }

  const currentPlayer = state.players.find((player) => player.id === playerId);
  const roomUrl = `${window.location.origin}/room/${state.roomId}`;
  const submitted = round?.submissionSummary.submittedPlayerIds.length ?? 0;
  const hasSubmitted = Boolean(round?.submissionSummary.submittedPlayerIds.includes(playerId));
  const assetsSettled = assetState !== "loading";
  const useRasterAssets = assetState === "ready";
  const shouldShowFinalResultScreen = state.phase === "gameResult" && (isFinalResultOpen || !state.lastRoundResult);
  const remainingMs = round ? round.deadline - now : 0;
  const isFinalMinute = state.phase === "playing" && Boolean(round) && remainingMs > 0 && remainingMs <= finalMinuteMs;
  const timeLabel =
    round && state.phase === "playing" ? (remainingMs <= finalMinuteMs ? formatTime(remainingMs) : "??:??") : "--:--";

  React.useEffect(() => {
    if (!hasSubmitted) return;
    setIsSubmittingSolution(false);
    submitInFlightRef.current = false;
  }, [hasSubmitted]);

  if (shouldShowFinalResultScreen) {
    return (
      <main className="app-shell phase-gameResult final-screen">
        <header className="topbar">
          <div>
            <span className="eyebrow">部屋</span>
            <strong>{state.roomId}</strong>
          </div>
          <button className="secondary icon" title="部屋URLをコピー" onClick={() => navigator.clipboard.writeText(roomUrl)}>
            <Copy size={18} />
          </button>
          <div>
            <span className="eyebrow">ラウンド</span>
            <strong>{state.totalRounds} / {state.totalRounds}</strong>
          </div>
          <div>
            <span className="eyebrow">残り時間</span>
            <strong>--:--</strong>
          </div>
          <button className="secondary topbar-end" onClick={leaveToLobby}>
            <LogOut size={18} /> <span>ゲーム終了</span>
          </button>
        </header>

        <section className="final-layout">
          <GameResultView state={state} />
          <button className="secondary" onClick={leaveToLobby}>
            <LogOut size={18} /> ゲーム終了
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell phase-${state.phase}`}>
      <header className="topbar">
        <div>
          <span className="eyebrow">部屋</span>
          <strong>{state.roomId}</strong>
        </div>
        <button className="secondary icon" title="部屋URLをコピー" onClick={() => navigator.clipboard.writeText(roomUrl)}>
          <Copy size={18} />
        </button>
        <div>
          <span className="eyebrow">ラウンド</span>
          <strong>{round ? `${round.roundNumber} / ${state.totalRounds}` : `0 / ${state.totalRounds}`}</strong>
        </div>
        <div className={`time-card${isFinalMinute ? " final-minute" : ""}`}>
          <span className="eyebrow">残り時間</span>
          <strong aria-live="polite">{timeLabel}</strong>
        </div>
        <button className="secondary topbar-end" onClick={leaveToLobby}>
          <LogOut size={18} /> <span>ゲーム終了</span>
        </button>
      </header>

      <section className="layout">
        <aside className="side">
          <PlayerList state={state} />
          <section className="panel room-actions">
            <span>{currentPlayer ? `あなた: ${displayPlayerName(currentPlayer.name)}` : "接続中"}</span>
            <span>送信済み: {submitted} / {state.players.length}</span>
            {state.phase === "waiting" ? (
              <button onClick={startGame} disabled={isStarting || !assetsSettled || !socketReady || !isSocketOpen(ws)}>
                {isStarting ? <LoadingLabel label="準備中..." /> : <><Play size={18} /> 開始</>}
              </button>
            ) : null}
            {state.phase === "waiting" && !assetsSettled ? (
              <span className="loading-status" role="status" aria-live="polite">
                <LoadingLabel label="画像を読み込み中..." />
              </span>
            ) : null}
            {state.phase === "playing" ? (
              <button className="secondary" onClick={forceEndRound} disabled={isForcingRoundEnd || !socketReady || !isSocketOpen(ws)}>
                {isForcingRoundEnd ? <LoadingLabel label="集計中..." /> : <><Flag size={18} /> ラウンド終了</>}
              </button>
            ) : null}
            <button className="secondary" onClick={leaveToLobby}>
              <LogOut size={18} /> ゲーム終了
            </button>
          </section>
          {state.lastRoundResult ? (
            <RoundResultView
              result={state.lastRoundResult}
              state={state}
              ws={ws}
              onShowGameResult={state.phase === "gameResult" ? () => setIsFinalResultOpen(true) : undefined}
            />
          ) : null}
        </aside>

        <section className="play-area">
          <div className="board-frame">
            <BoardView board={board} robots={robots} target={target} showActiveTarget={Boolean(round)} onMove={moveRobot} useRasterAssets={useRasterAssets} />
          </div>
          <GameControls
            state={state}
            local={local}
            goalReached={goalReached}
            onUndo={undo}
            onReset={reset}
            onSubmit={submit}
            isSubmitting={isSubmittingSolution}
            useRasterAssets={useRasterAssets}
          />
        </section>
      </section>
    </main>
  );
}

function App() {
  const { ws, socketReady, state, playerId, error, notice, acceptedSubmission } = useSocket();
  const assetState = useGameImageAssets();

  return (
    <>
      {state ? (
        <Room
          ws={ws}
          socketReady={socketReady}
          state={state}
          playerId={playerId}
          error={error}
          acceptedSubmission={acceptedSubmission}
          assetState={assetState}
        />
      ) : (
        <Lobby ws={ws} socketReady={socketReady} playerId={playerId} error={error} />
      )}
      <div className="toast-stack">
        {notice ? <div className="toast">{notice}</div> : null}
        {error ? <div className="toast error">{error}</div> : null}
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
  });
}
