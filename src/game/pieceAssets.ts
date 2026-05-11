import blackPiece from "../assets/pieces/processed/black.png";
import bluePiece from "../assets/pieces/processed/blue.png";
import greenPiece from "../assets/pieces/processed/green.png";
import redPiece from "../assets/pieces/processed/red.png";
import yellowPiece from "../assets/pieces/processed/yellow.png";
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
