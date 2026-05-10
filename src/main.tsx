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

const colorLabel: Record<RobotColor, string> = {
  red: "R",
  blue: "B",
  green: "G",
  yellow: "Y"
};

const colorName: Record<RobotColor, string> = {
  red: "Red",
  blue: "Blue",
  green: "Green",
  yellow: "Yellow"
};

function useNow(intervalMs = 250): number {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function sendJson(ws: WebSocket | null, message: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
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

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "roomCreated" || message.type === "joinedRoom") {
        setPlayerId(message.playerId);
        localStorage.setItem("slideBots.playerId", message.playerId);
        localStorage.setItem("slideBots.roomId", message.state.roomId);
        setState(message.state);
        setError("");
      }
      if (message.type === "roomState") setState(message.state);
      if (message.type === "submissionAccepted") {
        setNotice(`Submitted ${message.moveCount} moves.`);
        setError("");
      }
      if (message.type === "submissionRejected") {
        setError(message.reason);
      }
      if (message.type === "roundResult") {
        setNotice("Round finished.");
      }
      if (message.type === "gameResult") {
        setNotice("Game finished.");
      }
      if (message.type === "error") {
        setError(message.message);
      }
    });

    socket.addEventListener("close", () => setNotice("WebSocket disconnected. Refresh to reconnect."));
    return () => socket.close();
  }, []);

  return { ws, state, setState, playerId, error, setError, notice, setNotice };
}

function targetGlyph(target: Target): string {
  if (target.shape === "circle") return "●";
  if (target.shape === "triangle") return "▲";
  if (target.shape === "square") return "■";
  if (target.shape === "cross") return "✚";
  return "◆";
}

function BoardView({
  board,
  robots,
  target,
  onMove,
  debug
}: {
  board: Board;
  robots: RobotPositions;
  target: Target;
  onMove?: (robot: RobotColor, dx: number, dy: number) => void;
  debug: boolean;
}) {
  const pointerStart = React.useRef<{ x: number; y: number; robot: RobotColor } | null>(null);

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
      aria-label="16 by 16 slide bots board"
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
          {debug ? (
            <text x={cell.x + 0.5} y={cell.y + 0.55} className="coord">
              {cell.x},{cell.y}
            </text>
          ) : null}
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
      {Object.entries(robots).map(([color, cell]) => (
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
  const [roomId, setRoomId] = React.useState(localStorage.getItem("slideBots.roomId") ?? "");

  function remember(): void {
    localStorage.setItem("slideBots.name", name);
  }

  return (
    <section className="join-panel">
      <div>
        <h1>Slide Bots</h1>
        <p>Private simultaneous slide puzzle rooms for 1 to 10 players.</p>
      </div>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
      </label>
      <div className="join-actions">
        <button
          onClick={() => {
            remember();
            sendJson(ws, { type: "createRoom", name, playerId });
          }}
        >
          <Play size={18} /> Create Room
        </button>
        <label>
          Room Code
          <input value={roomId} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="ABCD" />
        </label>
        <button
          className="secondary"
          onClick={() => {
            remember();
            sendJson(ws, { type: "joinRoom", roomId, name, playerId });
          }}
        >
          Join
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
          <span>{player.name}</span>
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
      <div>
        <span className="eyebrow">Target</span>
        <strong>
          {round ? `${colorName[round.target.color]} bot to ${targetGlyph(round.target)}` : "Waiting"}
        </strong>
      </div>
      <div>
        <span className="eyebrow">Moves</span>
        <strong>{local?.moveHistory.length ?? 0}</strong>
      </div>
      <div className="buttons">
        <button className="secondary icon" onClick={onUndo} disabled={!local?.moveHistory.length} title="Undo">
          <Undo2 size={18} />
        </button>
        <button className="secondary icon" onClick={onReset} disabled={!round} title="Reset">
          <RotateCcw size={18} />
        </button>
        <button onClick={onSubmit} disabled={!canSubmit}>
          <Send size={18} /> Submit
        </button>
      </div>
      {local?.submittedMoveCount ? <span className="submitted">Best submitted: {local.submittedMoveCount}</span> : null}
    </section>
  );
}

function RoundResultView({ result, state, ws }: { result: RoundResult; state: PublicRoomState; ws: WebSocket | null }) {
  const winner = state.players.find((player) => player.id === result.winnerPlayerId);
  return (
    <section className="panel result">
      <h2>Round {result.roundNumber} Result</h2>
      <p>{winner ? `${winner.name} wins with ${result.winningSubmission?.moveCount} moves.` : "No valid submissions this round."}</p>
      <div className="submission-list">
        {result.validSubmissions.map((submission) => {
          const player = state.players.find((candidate) => candidate.id === submission.playerId);
          return (
            <span key={`${submission.playerId}-${submission.submittedAt}`}>
              {player?.name ?? "Player"}: {submission.moveCount}
            </span>
          );
        })}
      </div>
      {state.phase === "roundResult" ? (
        <button onClick={() => sendJson(ws, { type: "nextRound" })}>
          <StepForward size={18} /> Next Round
        </button>
      ) : null}
    </section>
  );
}

function GameResultView({ state }: { state: PublicRoomState }) {
  if (!state.gameResult) return null;
  return (
    <section className="panel result">
      <h2>Final Result</h2>
      <p>Winner: {state.gameResult.winners.map((winner) => winner.name).join(", ")}</p>
      <div className="submission-list">
        {state.gameResult.players
          .slice()
          .sort((a, b) => b.score - a.score)
          .map((player) => (
            <span key={player.id}>
              {player.name}: {player.score}
            </span>
          ))}
      </div>
    </section>
  );
}

function Room({ ws, state, playerId }: { ws: WebSocket | null; state: PublicRoomState; playerId: string }) {
  const round = state.currentRound;
  const [debug, setDebug] = React.useState(false);
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
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Room</span>
          <strong>{state.roomId}</strong>
        </div>
        <button className="secondary icon" title="Copy room URL" onClick={() => navigator.clipboard.writeText(roomUrl)}>
          <Copy size={18} />
        </button>
        <div>
          <span className="eyebrow">Round</span>
          <strong>{round ? `${round.roundNumber} / ${state.totalRounds}` : `0 / ${state.totalRounds}`}</strong>
        </div>
        <div>
          <span className="eyebrow">Time</span>
          <strong>{round ? formatTime(round.deadline - now) : "--:--"}</strong>
        </div>
      </header>

      <section className="layout">
        <aside className="side">
          <PlayerList state={state} />
          <section className="panel room-actions">
            <span>{currentPlayer ? `You are ${currentPlayer.name}` : "Connected"}</span>
            <span>Submitted: {submitted} / {state.players.length}</span>
            <label className="debug-toggle">
              <input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
              Coordinates
            </label>
            {state.phase === "waiting" ? (
              <button onClick={() => sendJson(ws, { type: "startGame" })}>
                <Play size={18} /> Start
              </button>
            ) : null}
          </section>
          {state.lastRoundResult ? <RoundResultView result={state.lastRoundResult} state={state} ws={ws} /> : null}
          {state.phase === "gameResult" ? <GameResultView state={state} /> : null}
        </aside>

        <section className="play-area">
          <BoardView board={board} robots={robots} target={target} onMove={moveRobot} debug={debug} />
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
