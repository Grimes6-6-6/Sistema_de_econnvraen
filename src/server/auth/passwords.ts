import "server-only";

import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#%+_-";
const ALPHABET = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

function pick(source: string): string {
  return source[randomInt(0, source.length)];
}

export function createTemporaryPassword(): string {
  const characters = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (characters.length < 20) characters.push(pick(ALPHABET));

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex],
      characters[index],
    ];
  }

  return characters.join("");
}
