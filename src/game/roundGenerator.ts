import { fixedBoard } from "./boards/fixedBoard";
import { isBlocked, sameCell } from "./rules";
import { solveBfs } from "./solver";
import { Board, Cell, RobotPositions, Target, robotColors } from "./types";

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
  const passes = [
    { min: 6, max: 20, attempts: 120 },
    { min: 4, max: 25, attempts: 80 },
    { min: 1, max: 25, attempts: 80 }
  ];

  for (const pass of passes) {
    for (let i = 0; i < pass.attempts; i += 1) {
      const target = randomChoice(fixedBoard.targets);
      const initialRobots = generateRobotPositions(fixedBoard, target);
      const solution = solveBfs(fixedBoard, initialRobots, target, pass.max);
      if (solution.solvable && solution.minMoves >= pass.min && solution.minMoves <= pass.max) {
        return { board: fixedBoard, target, initialRobots, solutionMoves: solution.minMoves };
      }
    }
  }

  const target = randomChoice(fixedBoard.targets);
  return { board: fixedBoard, target, initialRobots: generateRobotPositions(fixedBoard, target), solutionMoves: 0 };
}
