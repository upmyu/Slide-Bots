import { describe, expect, it } from "vitest";
import { fixedBoard } from "./boards/fixedBoard";
import { applyMove, isGoalReached, validateSubmission } from "./rules";
import { solveBfs } from "./solver";
import { Board, RobotPositions } from "./types";

const testBoard: Board = {
  ...fixedBoard,
  walls: fixedBoard.walls.map((wall, index) => {
    const x = index % fixedBoard.width;
    const y = Math.floor(index / fixedBoard.width);
    let mask = 0;
    if (y === 0) mask |= 1;
    if (x === fixedBoard.width - 1) mask |= 2;
    if (y === fixedBoard.height - 1) mask |= 4;
    if (x === 0) mask |= 8;
    return mask;
  }),
  blocked: []
};

describe("slide rules", () => {
  const robots: RobotPositions = {
    red: { x: 3, y: 3 },
    blue: { x: 3, y: 5 },
    green: { x: 12, y: 12 },
    yellow: { x: 14, y: 14 },
    black: { x: 0, y: 15 }
  };

  it("slides until blocked by another robot", () => {
    const next = applyMove(testBoard, robots, { robot: "red", direction: "S" });
    expect(next?.red).toEqual({ x: 3, y: 4 });
  });

  it("rejects submissions that do not reach the target", () => {
    const result = validateSubmission(fixedBoard, robots, fixedBoard.targets[0], [{ robot: "red", direction: "E" }]);
    expect(result.valid).toBe(false);
  });

  it("can run a bounded BFS search", () => {
    const result = solveBfs(testBoard, robots, { x: 3, y: 4, color: "red", shape: "circle" }, 3);
    expect(result.solvable).toBe(true);
  });

  it("lets black complete only the rainbow target", () => {
    expect(isGoalReached(testBoard, robots, { x: 0, y: 15, color: "rainbow", shape: "vortex" })).toBe(true);
    expect(isGoalReached(testBoard, robots, { x: 0, y: 15, color: "red", shape: "circle" })).toBe(false);
  });
});
