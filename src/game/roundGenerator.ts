import { fixedBoard } from "./boards/fixedBoard";
import { isBlocked, sameCell } from "./rules";
import { solveBfs } from "./solver";
import { Board, Cell, RobotPositions, Target, robotColors } from "./types";

const setupPasses = [
  { min: 6, max: 6, attempts: 6 },
  { min: 4, max: 6, attempts: 6 },
  { min: 1, max: 6, attempts: 6 }
];

const fallbackSetup = {
  board: fixedBoard,
  target: { x: 3, y: 9, color: "yellow", shape: "cross" },
  initialRobots: {
    red: { x: 9, y: 5 },
    blue: { x: 12, y: 6 },
    green: { x: 5, y: 12 },
    yellow: { x: 2, y: 13 },
    black: { x: 13, y: 15 }
  },
  solutionMoves: 7
} satisfies { board: Board; target: Target; initialRobots: RobotPositions; solutionMoves: number };

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

function fallbackRoundSetup(options: RoundSetupOptions = {}) {
  const used = new Set(options.usedTargetKeys ?? []);
  const target = availableTargets(options.usedTargetKeys).find((candidate) => !used.has(targetKey(candidate))) ?? fallbackSetup.target;
  const initialRobots = options.initialRobots ?? fallbackSetup.initialRobots;
  const solution = solveBfs(fixedBoard, initialRobots, target, 25);
  return {
    ...fallbackSetup,
    target,
    initialRobots,
    solutionMoves: solution.solvable ? solution.minMoves : fallbackSetup.solutionMoves
  };
}

function generateRoundSetupWithOptions(
  options: RoundSetupOptions = {}
): { board: Board; target: Target; initialRobots: RobotPositions; solutionMoves: number } {
  const targets = availableTargets(options.usedTargetKeys);
  for (const pass of setupPasses) {
    for (let i = 0; i < pass.attempts; i += 1) {
      const target = randomChoice(targets);
      const initialRobots = options.initialRobots ?? generateRobotPositions(fixedBoard, target);
      const solution = solveBfs(fixedBoard, initialRobots, target, pass.max);
      if (solution.solvable && solution.minMoves >= pass.min && solution.minMoves <= pass.max) {
        return { board: fixedBoard, target, initialRobots, solutionMoves: solution.minMoves };
      }
    }
  }

  return fallbackRoundSetup(options);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function generateRoundSetupAsync(options: RoundSetupOptions = {}): Promise<{
  board: Board;
  target: Target;
  initialRobots: RobotPositions;
  solutionMoves: number;
}> {
  const targets = availableTargets(options.usedTargetKeys);
  for (const pass of setupPasses) {
    for (let i = 0; i < pass.attempts; i += 1) {
      const target = randomChoice(targets);
      const initialRobots = options.initialRobots ?? generateRobotPositions(fixedBoard, target);
      const solution = solveBfs(fixedBoard, initialRobots, target, pass.max);
      if (solution.solvable && solution.minMoves >= pass.min && solution.minMoves <= pass.max) {
        return { board: fixedBoard, target, initialRobots, solutionMoves: solution.minMoves };
      }
      await yieldToEventLoop();
    }
  }

  return fallbackRoundSetup(options);
}
