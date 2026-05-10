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
    [5, 1, "W"],
    [5, 1, "S"],
    [7, 2, "W"],
    [7, 2, "S"],
    [11, 2, "E"],
    [11, 2, "S"],
    [13, 3, "N"],
    [13, 3, "E"],
    [3, 4, "N"],
    [3, 4, "E"],
    [10, 4, "W"],
    [10, 4, "S"],
    [6, 5, "N"],
    [6, 5, "W"],
    [12, 5, "N"],
    [12, 5, "W"],
    [1, 6, "N"],
    [1, 6, "E"],
    [12, 9, "N"],
    [12, 9, "W"],
    [3, 9, "N"],
    [3, 9, "E"],
    [10, 10, "E"],
    [10, 10, "S"],
    [6, 11, "N"],
    [6, 11, "W"],
    [1, 12, "S"],
    [1, 12, "W"],
    [14, 12, "N"],
    [14, 12, "W"],
    [4, 14, "N"],
    [4, 14, "W"],
    [11, 14, "E"],
    [11, 14, "S"],
    [7, 7, "N"],
    [8, 7, "N"],
    [7, 7, "W"],
    [7, 8, "W"],
    [8, 7, "E"],
    [8, 8, "E"],
    [7, 8, "S"],
    [8, 8, "S"],
    [2, 0, "E"],
    [6, 0, "E"],
    [10, 0, "E"],
    [14, 0, "E"],
    [1, 15, "E"],
    [6, 15, "E"],
    [12, 15, "E"],
    [0, 6, "S"],
    [0, 12, "S"],
    [15, 5, "S"],
    [15, 9, "S"],
    [15, 12, "S"]
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
  { x: 5, y: 1, color: "blue", shape: "circle" },
  { x: 7, y: 2, color: "rainbow", shape: "vortex" },
  { x: 11, y: 2, color: "red", shape: "square" },
  { x: 13, y: 3, color: "yellow", shape: "circle" },
  { x: 3, y: 4, color: "red", shape: "cross" },
  { x: 10, y: 4, color: "green", shape: "cross" },
  { x: 6, y: 5, color: "green", shape: "square" },
  { x: 12, y: 5, color: "blue", shape: "triangle" },
  { x: 1, y: 6, color: "yellow", shape: "triangle" },
  { x: 12, y: 9, color: "blue", shape: "cross" },
  { x: 3, y: 9, color: "yellow", shape: "cross" },
  { x: 10, y: 10, color: "yellow", shape: "square" },
  { x: 6, y: 11, color: "blue", shape: "square" },
  { x: 1, y: 12, color: "green", shape: "triangle" },
  { x: 14, y: 12, color: "red", shape: "triangle" },
  { x: 4, y: 14, color: "red", shape: "circle" },
  { x: 11, y: 14, color: "green", shape: "circle" }
];

export const fixedBoard: Board = {
  width,
  height,
  walls: createWalls(),
  blocked: centerBlocked,
  targets: fixedTargets
};
