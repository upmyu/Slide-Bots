import { Board, Cell, Direction, Target, WallMask } from "../types";

const width = 16;
const height = 16;

const opposite: Record<Direction, Direction> = {
  N: "S",
  E: "W",
  S: "N",
  W: "E"
};

const bit: Record<Direction, WallMask> = {
  N: 1,
  E: 2,
  S: 4,
  W: 8
};

const delta: Record<Direction, Cell> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 }
};

function index(x: number, y: number): number {
  return y * width + x;
}

function createWalls(): WallMask[] {
  const walls = Array<WallMask>(width * height).fill(0);

  function addWall(x: number, y: number, dir: Direction): void {
    walls[index(x, y)] |= bit[dir];
    const next = { x: x + delta[dir].x, y: y + delta[dir].y };
    if (next.x >= 0 && next.x < width && next.y >= 0 && next.y < height) {
      walls[index(next.x, next.y)] |= bit[opposite[dir]];
    }
  }

  for (let x = 0; x < width; x += 1) {
    addWall(x, 0, "N");
    addWall(x, height - 1, "S");
  }
  for (let y = 0; y < height; y += 1) {
    addWall(0, y, "W");
    addWall(width - 1, y, "E");
  }

  [
    [1, 1, "S"],
    [1, 1, "E"],
    [4, 1, "E"],
    [5, 1, "S"],
    [10, 1, "S"],
    [11, 1, "W"],
    [14, 1, "S"],
    [14, 1, "W"],
    [2, 4, "E"],
    [2, 4, "N"],
    [6, 3, "S"],
    [6, 3, "E"],
    [9, 3, "E"],
    [9, 3, "S"],
    [13, 4, "N"],
    [13, 4, "W"],
    [3, 6, "S"],
    [3, 6, "W"],
    [11, 6, "S"],
    [11, 6, "E"],
    [2, 9, "N"],
    [2, 9, "E"],
    [5, 11, "E"],
    [5, 11, "S"],
    [10, 11, "W"],
    [10, 11, "S"],
    [13, 9, "N"],
    [13, 9, "W"],
    [1, 14, "N"],
    [1, 14, "E"],
    [4, 14, "W"],
    [4, 14, "N"],
    [11, 14, "N"],
    [11, 14, "E"],
    [14, 14, "N"],
    [14, 14, "W"],
    [6, 8, "W"],
    [9, 8, "E"],
    [8, 6, "N"],
    [8, 9, "S"]
  ].forEach(([x, y, dir]) => addWall(x as number, y as number, dir as Direction));

  return walls;
}

export const centerBlocked: Cell[] = [
  { x: 7, y: 7 },
  { x: 8, y: 7 },
  { x: 7, y: 8 },
  { x: 8, y: 8 }
];

export const fixedTargets: Target[] = [
  { x: 1, y: 1, color: "red", shape: "circle" },
  { x: 5, y: 1, color: "blue", shape: "triangle" },
  { x: 10, y: 1, color: "green", shape: "square" },
  { x: 14, y: 1, color: "yellow", shape: "cross" },
  { x: 2, y: 4, color: "blue", shape: "circle" },
  { x: 6, y: 3, color: "red", shape: "triangle" },
  { x: 9, y: 3, color: "yellow", shape: "square" },
  { x: 13, y: 4, color: "green", shape: "cross" },
  { x: 3, y: 6, color: "green", shape: "circle" },
  { x: 11, y: 6, color: "red", shape: "square" },
  { x: 2, y: 9, color: "yellow", shape: "triangle" },
  { x: 13, y: 9, color: "blue", shape: "cross" },
  { x: 5, y: 11, color: "yellow", shape: "vortex" },
  { x: 10, y: 11, color: "blue", shape: "vortex" },
  { x: 1, y: 14, color: "green", shape: "triangle" },
  { x: 14, y: 14, color: "red", shape: "cross" }
];

export const fixedBoard: Board = {
  width,
  height,
  walls: createWalls(),
  blocked: centerBlocked,
  targets: fixedTargets
};
