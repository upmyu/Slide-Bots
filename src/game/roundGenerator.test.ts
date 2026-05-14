import { describe, expect, it } from "vitest";
import { fixedBoard } from "./boards/fixedBoard";
import { generateRoundSetupAsync, targetKey } from "./roundGenerator";
import { RobotPositions } from "./types";

describe("round generator", () => {
  it("reuses provided robot positions and avoids used targets", async () => {
    const initialRobots: RobotPositions = {
      red: { x: 9, y: 5 },
      blue: { x: 12, y: 6 },
      green: { x: 5, y: 12 },
      yellow: { x: 2, y: 13 },
      black: { x: 13, y: 15 }
    };
    const onlyAvailableTarget = fixedBoard.targets[0];
    const usedTargetKeys = fixedBoard.targets.slice(1).map(targetKey);

    const setup = await generateRoundSetupAsync({ initialRobots, usedTargetKeys });

    expect(setup.initialRobots).toBe(initialRobots);
    expect(targetKey(setup.target)).toBe(targetKey(onlyAvailableTarget));
  });
});
