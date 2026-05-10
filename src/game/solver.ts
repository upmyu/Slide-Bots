import { applyMove, isGoalReached, stateKey } from "./rules";
import { Board, Move, RobotPositions, SolverResult, Target, directions, robotColors } from "./types";

type QueueItem = {
  robots: RobotPositions;
  moves: Move[];
};

export function solveBfs(board: Board, initialRobots: RobotPositions, target: Target, maxDepth = 25): SolverResult {
  if (isGoalReached(board, initialRobots, target)) {
    return { solvable: true, minMoves: 0, moves: [] };
  }

  const queue: QueueItem[] = [{ robots: initialRobots, moves: [] }];
  const seen = new Set<string>([stateKey(initialRobots)]);
  let cursor = 0;

  while (cursor < queue.length) {
    const item = queue[cursor];
    cursor += 1;

    if (item.moves.length >= maxDepth) continue;

    for (const robot of robotColors) {
      for (const direction of directions) {
        const move = { robot, direction };
        const nextRobots = applyMove(board, item.robots, move);
        if (!nextRobots) continue;

        const key = stateKey(nextRobots);
        if (seen.has(key)) continue;

        const moves = [...item.moves, move];
        if (isGoalReached(board, nextRobots, target)) {
          return { solvable: true, minMoves: moves.length, moves };
        }

        seen.add(key);
        queue.push({ robots: nextRobots, moves });
      }
    }
  }

  return { solvable: false };
}
