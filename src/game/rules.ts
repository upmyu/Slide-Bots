import { Board, Cell, Direction, Move, RobotColor, RobotPositions, directions, robotColors } from "./types";

const wallBits: Record<Direction, number> = {
  N: 1,
  E: 2,
  S: 4,
  W: 8
};

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

export function hasWall(board: Board, x: number, y: number, dir: Direction): boolean {
  const mask = board.walls[y * board.width + x] ?? 0;
  return (mask & wallBits[dir]) !== 0;
}

export function step(cell: Cell, direction: Direction): Cell {
  if (direction === "N") return { x: cell.x, y: cell.y - 1 };
  if (direction === "E") return { x: cell.x + 1, y: cell.y };
  if (direction === "S") return { x: cell.x, y: cell.y + 1 };
  return { x: cell.x - 1, y: cell.y };
}

export function isInside(board: Board, cell: Cell): boolean {
  return cell.x >= 0 && cell.x < board.width && cell.y >= 0 && cell.y < board.height;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isBlocked(board: Board, cell: Cell): boolean {
  return board.blocked.some((blocked) => sameCell(blocked, cell));
}

export function robotAt(robots: RobotPositions, cell: Cell, except?: RobotColor): RobotColor | undefined {
  return robotColors.find((color) => color !== except && sameCell(robots[color], cell));
}

export function canMoveOneStep(
  board: Board,
  robots: RobotPositions,
  from: Cell,
  direction: Direction,
  movingRobot?: RobotColor
): boolean {
  if (!isInside(board, from)) return false;
  if (hasWall(board, from.x, from.y, direction)) return false;

  const to = step(from, direction);
  if (!isInside(board, to)) return false;
  if (isBlocked(board, to)) return false;
  if (robotAt(robots, to, movingRobot)) return false;

  return true;
}

export function slideRobot(
  board: Board,
  robots: RobotPositions,
  robot: RobotColor,
  direction: Direction
): RobotPositions {
  const next = Object.fromEntries(robotColors.map((color) => [color, { ...robots[color] }])) as RobotPositions;
  let pos = { ...next[robot] };

  while (canMoveOneStep(board, next, pos, direction, robot)) {
    pos = step(pos, direction);
  }

  next[robot] = pos;
  return next;
}

export function applyMove(board: Board, robots: RobotPositions, move: Move): RobotPositions | null {
  if (!robotColors.includes(move.robot) || !directions.includes(move.direction)) return null;
  const next = slideRobot(board, robots, move.robot, move.direction);
  return sameCell(next[move.robot], robots[move.robot]) ? null : next;
}

export function isGoalReached(board: Board, robots: RobotPositions, targetIndexOrTarget: number | Board["targets"][number]): boolean {
  const target = typeof targetIndexOrTarget === "number" ? board.targets[targetIndexOrTarget] : targetIndexOrTarget;
  if (target.color === "rainbow") {
    return robotColors.some((color) => sameCell(robots[color], target));
  }
  return sameCell(robots[target.color], target);
}

export function applyMoves(board: Board, initialRobots: RobotPositions, moves: Move[]): RobotPositions | null {
  let robots = initialRobots;

  for (const move of moves) {
    const next = applyMove(board, robots, move);
    if (!next) return null;
    robots = next;
  }

  return robots;
}

export function validateSubmission(
  board: Board,
  initialRobots: RobotPositions,
  target: Board["targets"][number],
  moves: Move[]
): { valid: true; finalRobots: RobotPositions } | { valid: false; reason: string } {
  if (moves.length === 0) return { valid: false, reason: "手順が入力されていません。" };
  if (moves.length > 80) return { valid: false, reason: "手数が多すぎます。" };

  const finalRobots = applyMoves(board, initialRobots, moves);
  if (!finalRobots) return { valid: false, reason: "移動できない手順が含まれています。" };
  if (!isGoalReached(board, finalRobots, target)) {
    return { valid: false, reason: "対象のボットが目標に到達していません。" };
  }

  return { valid: true, finalRobots };
}

export function detectSwipeDirection(dx: number, dy: number): Direction | null {
  const threshold = 20;

  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
    return null;
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "E" : "W";
  }

  return dy > 0 ? "S" : "N";
}

export function stateKey(robots: RobotPositions): string {
  return robotColors.map((color) => `${robots[color].x},${robots[color].y}`).join("|");
}
