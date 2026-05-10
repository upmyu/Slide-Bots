import React from "react";
import { createRoot } from "react-dom/client";
import { RotateCcw, Undo2, Copy, Play, Send, StepForward } from "lucide-react";
import { fixedBoard } from "./game/boards/fixedBoard";
import { applyMove, detectSwipeDirection, isGoalReached, robotAt, sameCell } from "./game/rules";
import { Board, ClientMessage, Move, PublicRoomState, RobotColor, RobotPositions, RoundResult, ServerMessage, Target } from "./game/types";
import "./styles.css";

type LocalPlayState = {
  robots: RobotPositions;
  moveHistory: Move[];
  submittedMoveCount?: number;
};

type RobotRenderPositions = Record<RobotColor, { x: number; y: number }>;

const colorLabel: Record<RobotColor, string> = {
  red: "R",
  blue: "B",
  green: "G",
  yellow: "Y"
};

const colorName: Record<RobotColor, string> = {
  red: "赤",
  blue: "青",
  green: "緑",
  yellow: "黄"
};

function useNow(intervalMs = 250): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function cloneRobotPositions(robots: RobotPositions): RobotRenderPositions {
  return {
    red: { ...robots.red },
    blue: { ...robots.blue },
    green: { ...robots.green },
    yellow: { ...robots.yellow }
  };
}

function robotPositionsKey(robots: RobotPositions): string {
  return `${robots.red.x},${robots.red.y}|${robots.blue.x},${robots.blue.y}|${robots.green.x},${robots.green.y}|${robots.yellow.x},${robots.yellow.y}`;
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

function sendJson(ws: WebSocket | null, message: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
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
  const [state, setState] = React.useState<PublicRoomState | null>(null);
  const [playerId, setPlayerId] = React.useState(localStorage.getItem("slideBots.playerId") ?? "");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  React.useEffect(() => {
    const socket = new WebSocket(wsUrl());
    setWs(socket);

    socket.addEventListener("open", () => {
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
      if (message.type === "error") {
        setError(message.message);
      }
    });

    socket.addEventListener("close", () => setNotice("接続が切れました。再接続するには更新してください。"));
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

  return { ws, state, setState, playerId, error, setError, notice, setNotice };
}

function targetGlyph(target: Target): string {
  if (target.shape === "circle") return "●";
  if (target.shape === "triangle") return "▲";
  if (target.shape === "square") return "■";
  if (target.shape === "cross") return "×";
  return "◎";
}

function BoardView({
  board,
  robots,
  target,
  onMove
}: {
  board: Board;
  robots: RobotPositions;
  target: Target;
  onMove?: (robot: RobotColor, dx: number, dy: number) => void;
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
      ...(["red", "blue", "green", "yellow"] as RobotColor[]).map((color) => Math.hypot(to[color].x - from[color].x, to[color].y - from[color].y))
    );

    if (maxDistance === 0) return;

    const duration = Math.min(460, 170 + maxDistance * 28);
    const startedAt = performance.now();
    let frameId = 0;

    function tick(now: number): void {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = (["red", "blue", "green", "yellow"] as RobotColor[]).reduce((positions, color) => {
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
      {board.targets.map((item) => (
        <text
          key={`target-${item.x}-${item.y}-${item.color}-${item.shape}`}
          x={item.x + 0.5}
          y={item.y + 0.67}
          className={`target ${item.color}`}
        >
          {targetGlyph(item)}
        </text>
      ))}
      <rect x={target.x + 0.08} y={target.y + 0.08} width="0.84" height="0.84" className="active-target" />
      {Object.entries(displayRobots).map(([color, cell]) => (
        <g key={color} className="robot-hit">
          <circle cx={cell.x + 0.5} cy={cell.y + 0.5} r="0.44" className={`robot ${color}`} />
          <text x={cell.x + 0.5} y={cell.y + 0.64} className="robot-label">
            {colorLabel[color as RobotColor]}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Lobby({ ws, playerId }: { ws: WebSocket | null; playerId: string }) {
  const [name, setName] = React.useState(localStorage.getItem("slideBots.name") ?? "");
  const [roomId, setRoomId] = React.useState(savedRoomId());

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
          onClick={() => {
            remember();
            sendJson(ws, { type: "createRoom", name, playerId });
          }}
        >
          <Play size={18} /> 部屋を作る
        </button>
        <label>
          部屋コード
          <input value={roomId} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="ABCD" />
        </label>
        <button
          className="secondary"
          onClick={() => {
            remember();
            sendJson(ws, { type: "joinRoom", roomId, name, playerId });
          }}
        >
          参加
        </button>
      </div>
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
  onSubmit
}: {
  state: PublicRoomState;
  local: LocalPlayState | null;
  goalReached: boolean;
  onUndo: () => void;
  onReset: () => void;
  onSubmit: () => void;
}) {
  const now = useNow();
  const round = state.currentRound;
  const deadlineOpen = round ? now < round.deadline : false;
  const canSubmit = state.phase === "playing" && goalReached && Boolean(local?.moveHistory.length) && deadlineOpen;

  return (
    <section className="panel controls">
      <div className="goal-cell" aria-label={round ? `目標: ${colorName[round.target.color]} ${targetGlyph(round.target)}` : "待機中"}>
        {round ? <span className={`goal-marker ${round.target.color}`}>{targetGlyph(round.target)}</span> : <strong>待機中</strong>}
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
        <button onClick={onSubmit} disabled={!canSubmit}>
          <Send size={18} /> 送信
        </button>
      </div>
      {local?.submittedMoveCount ? <span className="submitted">送信済み最短: {local.submittedMoveCount}手</span> : null}
    </section>
  );
}

function RoundResultView({ result, state, ws }: { result: RoundResult; state: PublicRoomState; ws: WebSocket | null }) {
  const winner = state.players.find((player) => player.id === result.winnerPlayerId);
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
        <button onClick={() => sendJson(ws, { type: "nextRound" })}>
          <StepForward size={18} /> 次のラウンド
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

function Room({ ws, state, playerId }: { ws: WebSocket | null; state: PublicRoomState; playerId: string }) {
  const round = state.currentRound;
  const [local, setLocal] = React.useState<LocalPlayState | null>(null);
  const now = useNow();

  React.useEffect(() => {
    if (!round) {
      setLocal(null);
      return;
    }
    setLocal({
      robots: round.initialRobots,
      moveHistory: []
    });
  }, [round?.roundNumber, round?.deadline]);

  const board = round?.board ?? fixedBoard;
  const target = round?.target ?? fixedBoard.targets[0];
  const robots = local?.robots ?? round?.initialRobots ?? {
    red: { x: 0, y: 0 },
    blue: { x: 2, y: 0 },
    green: { x: 4, y: 0 },
    yellow: { x: 6, y: 0 }
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
  }, [round?.roundNumber, round?.deadline, state.phase, state.lastRoundResult?.winningSubmission?.submittedAt]);

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
    if (!local) return;
    sendJson(ws, { type: "submitSolution", moves: local.moveHistory });
    setLocal({ ...local, submittedMoveCount: local.moveHistory.length });
  }

  const currentPlayer = state.players.find((player) => player.id === playerId);
  const roomUrl = `${window.location.origin}/room/${state.roomId}`;
  const submitted = round?.submissionSummary.submittedPlayerIds.length ?? 0;

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
        <div>
          <span className="eyebrow">残り時間</span>
          <strong>{round ? formatTime(round.deadline - now) : "--:--"}</strong>
        </div>
      </header>

      <section className="layout">
        <aside className="side">
          <PlayerList state={state} />
          <section className="panel room-actions">
            <span>{currentPlayer ? `あなた: ${displayPlayerName(currentPlayer.name)}` : "接続中"}</span>
            <span>送信済み: {submitted} / {state.players.length}</span>
            {state.phase === "waiting" ? (
              <button onClick={() => sendJson(ws, { type: "startGame" })}>
                <Play size={18} /> 開始
              </button>
            ) : null}
          </section>
          {state.lastRoundResult ? <RoundResultView result={state.lastRoundResult} state={state} ws={ws} /> : null}
          {state.phase === "gameResult" ? <GameResultView state={state} /> : null}
        </aside>

        <section className="play-area">
          <BoardView board={board} robots={robots} target={target} onMove={moveRobot} />
          <GameControls state={state} local={local} goalReached={goalReached} onUndo={undo} onReset={reset} onSubmit={submit} />
        </section>
      </section>
    </main>
  );
}

function App() {
  const { ws, state, playerId, error, notice } = useSocket();

  return (
    <>
      {state ? <Room ws={ws} state={state} playerId={playerId} /> : <Lobby ws={ws} playerId={playerId} />}
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
