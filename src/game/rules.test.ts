import { describe, expect, it } from "vitest";
import { fixedBoard } from "./boards/fixedBoard";
import { applyMove, validateSubmission } from "./rules";
import { solveBfs } from "./solver";
import { RobotPositions } from "./types";

describe("slide rules", () => {
  const robots: RobotPositions = {
    red: { x: 3, y: 3 },
    blue: { x: 3, y: 5 },
    green: { x: 12, y: 12 },
    yellow: { x: 14, y: 14 }
  };

  it("slides until blocked by another robot", () => {
    const next = applyMove(fixedBoard, robots, { robot: "red", direction: "S" });
    expect(next?.red).toEqual({ x: 3, y: 4 });
  });

  it("rejects submissions that do not reach the target", () => {
    const result = validateSubmission(fixedBoard, robots, fixedBoard.targets[0], [{ robot: "red", direction: "E" }]);
    expect(result.valid).toBe(false);
  });

  it("can run a bounded BFS search", () => {
    const result = solveBfs(fixedBoard, robots, { x: 3, y: 4, color: "red", shape: "circle" }, 3);
    expect(result.solvable).toBe(true);
  });
});
