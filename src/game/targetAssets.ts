import allSpiral from "../assets/goals/all_spiral.png";
import blueCircular from "../assets/goals/blue_circular.png";
import blueDiamond from "../assets/goals/blue_diamond.png";
import blueSpiral from "../assets/goals/blue_spiral.png";
import blueTriangular from "../assets/goals/blue_triangular.png";
import greenCircular from "../assets/goals/green_circular.png";
import greenDiamond from "../assets/goals/green_diamond.png";
import greenSpiral from "../assets/goals/green_spiral.png";
import greenTriangular from "../assets/goals/green_triangular.png";
import redCircular from "../assets/goals/red_circular.png";
import redDiamond from "../assets/goals/red_diamond.png";
import redSpiral from "../assets/goals/red_spiral.png";
import redTriangular from "../assets/goals/red_triangular.png";
import yellowCircular from "../assets/goals/yellow_circular.png";
import yellowDiamond from "../assets/goals/yellow_diamond.png";
import yellowSpiral from "../assets/goals/yellow_spiral.png";
import yellowTriangular from "../assets/goals/yellow_triangular.png";
import { Target, TargetColor, TargetShape } from "./types";

type ColoredTargetColor = Exclude<TargetColor, "rainbow">;
type ColoredTargetShape = Exclude<TargetShape, "vortex">;

const targetImages: Record<ColoredTargetColor, Record<ColoredTargetShape, string>> = {
  red: {
    circle: redCircular,
    triangle: redTriangular,
    square: redDiamond,
    cross: redSpiral
  },
  blue: {
    circle: blueCircular,
    triangle: blueTriangular,
    square: blueDiamond,
    cross: blueSpiral
  },
  green: {
    circle: greenCircular,
    triangle: greenTriangular,
    square: greenDiamond,
    cross: greenSpiral
  },
  yellow: {
    circle: yellowCircular,
    triangle: yellowTriangular,
    square: yellowDiamond,
    cross: yellowSpiral
  }
};

export const allTargetImages = [
  allSpiral,
  ...Object.values(targetImages).flatMap((imagesByShape) => Object.values(imagesByShape))
];

export function targetImageFor(target: Target): string {
  if (target.color === "rainbow" || target.shape === "vortex") {
    return allSpiral;
  }

  return targetImages[target.color][target.shape];
}
