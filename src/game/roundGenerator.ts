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
    blue: { x: 12, y: 5 },
    green: { x: 5, y: 12 },
    yellow: { x: 2, y: 13 },
    black: { x: 13, y: 15 }
  },
  solutionMoves: 7
} satisfies { board: Board; target: Target; initialRobots: RobotPositions; solutionMoves: number };

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
  return isBlocked(board, cell) || sameCell(cell, target) || taken.some((used) => sameCell(used, cell));
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
  for (const pass of setupPasses) {
    for (let i = 0; i < pass.attempts; i += 1) {
      const target = randomChoice(fixedBoard.targets);
      const initialRobots = generateRobotPositions(fixedBoard, target);
      const solution = solveBfs(fixedBoard, initialRobots, target, pass.max);
      if (solution.solvable && solution.minMoves >= pass.min && solution.minMoves <= pass.max) {
        return { board: fixedBoard, target, initialRobots, solutionMoves: solution.minMoves };
      }
    }
  }

  return fallbackSetup;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function generateRoundSetupAsync(): Promise<{
  board: Board;
  target: Target;
  initialRobots: RobotPositions;
  solutionMoves: number;
}> {
  for (const pass of setupPasses) {
    for (let i = 0; i < pass.attempts; i += 1) {
      const target = randomChoice(fixedBoard.targets);
      const initialRobots = generateRobotPositions(fixedBoard, target);
      const solution = solveBfs(fixedBoard, initialRobots, target, pass.max);
      if (solution.solvable && solution.minMoves >= pass.min && solution.minMoves <= pass.max) {
        return { board: fixedBoard, target, initialRobots, solutionMoves: solution.minMoves };
      }
      await yieldToEventLoop();
    }
  }

  return fallbackSetup;
}
