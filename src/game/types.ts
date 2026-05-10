export type RobotColor = "red" | "blue" | "green" | "yellow";
export type Direction = "N" | "E" | "S" | "W";
export type WallMask = number;

export type Cell = {
  x: number;
  y: number;
};

export type TargetShape = "circle" | "triangle" | "square" | "cross" | "vortex";

export type Target = {
  x: number;
  y: number;
  color: RobotColor;
  shape: TargetShape;
};

export type Board = {
  width: 16;
  height: 16;
  walls: WallMask[];
  blocked: Cell[];
  targets: Target[];
};

export type RobotPositions = Record<RobotColor, Cell>;

export type Move = {
  robot: RobotColor;
  direction: Direction;
};

export type Submission = {
  playerId: string;
  moves: Move[];
  submittedAt: number;
};

export type Player = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
};

export type RoomPhase = "waiting" | "playing" | "roundResult" | "gameResult";

export type RoundState = {
  roundNumber: number;
  board: Board;
  initialRobots: RobotPositions;
  target: Target;
  startedAt: number;
  deadline: number;
  submissions: Submission[];
};

export type RoomState = {
  roomId: string;
  phase: RoomPhase;
  players: Player[];
  currentRound?: RoundState;
  totalRounds: number;
  roundTimeSeconds: number;
};

export type ValidSubmission = {
  playerId: string;
  moves: Move[];
  moveCount: number;
  submittedAt: number;
};

export type RoundResult = {
  roundNumber: number;
  winnerPlayerId?: string;
  winningSubmission?: ValidSubmission;
  validSubmissions: ValidSubmission[];
  scores: Record<string, number>;
};

export type GameResult = {
  players: Player[];
  winners: Player[];
};

export type PublicRoomState = {
  roomId: string;
  phase: RoomPhase;
  players: Player[];
  totalRounds: number;
  roundTimeSeconds: number;
  lastRoundResult?: RoundResult;
  gameResult?: GameResult;
  currentRound?: {
    roundNumber: number;
    board: Board;
    initialRobots: RobotPositions;
    target: Target;
    deadline: number;
    submissionSummary: {
      submittedPlayerIds: string[];
    };
  };
};

export type ClientMessage =
  | { type: "createRoom"; name: string; playerId?: string }
  | { type: "joinRoom"; roomId: string; name: string; playerId?: string }
  | { type: "startGame" }
  | { type: "submitSolution"; moves: Move[] }
  | { type: "nextRound" }
  | { type: "leaveRoom" };

export type ServerMessage =
  | { type: "roomCreated"; roomId: string; playerId: string; state: PublicRoomState }
  | { type: "joinedRoom"; playerId: string; state: PublicRoomState }
  | { type: "roomState"; state: PublicRoomState }
  | { type: "submissionAccepted"; moveCount: number }
  | { type: "submissionRejected"; reason: string }
  | { type: "roundResult"; result: RoundResult }
  | { type: "gameResult"; result: GameResult }
  | { type: "error"; message: string };

export type SolverResult =
  | {
      solvable: true;
      minMoves: number;
      moves: Move[];
    }
  | {
      solvable: false;
    };

export const robotColors: RobotColor[] = ["red", "blue", "green", "yellow"];
export const directions: Direction[] = ["N", "E", "S", "W"];
