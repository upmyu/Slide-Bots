import blackPiece from "../assets/pieces/black.webp";
import bluePiece from "../assets/pieces/blue.webp";
import greenPiece from "../assets/pieces/green.webp";
import redPiece from "../assets/pieces/red.webp";
import yellowPiece from "../assets/pieces/yellow.webp";
import type { RobotColor } from "./types";

const pieceImages: Record<RobotColor, string> = {
  red: redPiece,
  blue: bluePiece,
  green: greenPiece,
  yellow: yellowPiece,
  black: blackPiece
};

export const allPieceImages = Object.values(pieceImages);

export function pieceImageFor(color: RobotColor): string {
  return pieceImages[color];
}
