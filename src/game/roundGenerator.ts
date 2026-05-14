import { fixedBoard } from "./boards/fixedBoard";
import { isBlocked, sameCell } from "./rules";
import { Board, Cell, RobotPositions, Target, robotColors } from "./types";

const fallbackSetup = {
  target: { x: 3, y: 9, color: "yellow", shape: "cross" },
  initialRobots: {
    red: { x: 9, y: 5 },
    blue: { x: 12, y: 6 },
    green: { x: 5, y: 12 },
    yellow: { x: 2, y: 13 },
    black: { x: 13, y: 15 }
  },
  solutionMoves: 7
} satisfies { target: Target; initialRobots: RobotPositions; solutionMoves: number };

type RoundSetupOptions = {
  initialRobots?: RobotPositions;
  usedTargetKeys?: string[];
};

export function targetKey(target: Target): string {
  return `${target.color}-${target.shape}`;
}

function randomChoice<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomCell(board: Board): Cell {
  return {
    x: Math.floor(Math.random() * board.width),
    y: Math.floor(Math.random() * board.height)
  };
}

function isReserved(board: Board, cell: Cell, target: Target, taken: Cell[]): boolean {
  return (
    isBlocked(board, cell) ||
    sameCell(cell, target) ||
    taken.some((used) => sameCell(used, cell) || used.x === cell.x || used.y === cell.y)
  );
}

export function generateRobotPositions(board: Board, target: Target): RobotPositions {
  const taken: Cell[] = [];
  const entries = robotColors.map((color) => {
    let cell = randomCell(board);
    let attempts = 0;
    while (isReserved(board, cell, target, taken) && attempts < 500) {
      cell = randomCell(board);
      attempts += 1;
    }
    taken.push(cell);
    return [color, cell] as const;
  });

  return Object.fromEntries(entries) as RobotPositions;
}

export function generateRoundSetup(): { board: Board; target: Target; initialRobots: RobotPositions; solutionMoves: number } {
  return generateRoundSetupWithOptions();
}

function availableTargets(usedTargetKeys: string[] = []): Target[] {
  const used = new Set(usedTargetKeys);
  const targets = fixedBoard.targets.filter((target) => !used.has(targetKey(target)));
  return targets.length > 0 ? targets : fixedBoard.targets;
}

function generateRoundSetupWithOptions(
  options: RoundSetupOptions = {}
): { board: Board; target: Target; initialRobots: RobotPositions; solutionMoves: number } {
  const targets = availableTargets(options.usedTargetKeys);
  const target = targets.length > 0 ? randomChoice(targets) : fallbackSetup.target;
  const initialRobots = options.initialRobots ?? generateRobotPositions(fixedBoard, target);
  return { board: fixedBoard, target, initialRobots, solutionMoves: 0 };
}

export async function generateRoundSetupAsync(options: RoundSetupOptions = {}): Promise<{
  board: Board;
  target: Target;
  initialRobots: RobotPositions;
  solutionMoves: number;
}> {
  return generateRoundSetupWithOptions(options);
}
