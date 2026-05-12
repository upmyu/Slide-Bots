import allSpiral from "../assets/goals/all_spiral.webp";
import blueCircular from "../assets/goals/blue_circular.webp";
import blueDiamond from "../assets/goals/blue_diamond.webp";
import blueSpiral from "../assets/goals/blue_spiral.webp";
import blueTriangular from "../assets/goals/blue_triangular.webp";
import greenCircular from "../assets/goals/green_circular.webp";
import greenDiamond from "../assets/goals/green_diamond.webp";
import greenSpiral from "../assets/goals/green_spiral.webp";
import greenTriangular from "../assets/goals/green_triangular.webp";
import redCircular from "../assets/goals/red_circular.webp";
import redDiamond from "../assets/goals/red_diamond.webp";
import redSpiral from "../assets/goals/red_spiral.webp";
import redTriangular from "../assets/goals/red_triangular.webp";
import yellowCircular from "../assets/goals/yellow_circular.webp";
import yellowDiamond from "../assets/goals/yellow_diamond.webp";
import yellowSpiral from "../assets/goals/yellow_spiral.webp";
import yellowTriangular from "../assets/goals/yellow_triangular.webp";
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
