import seedrandom from "seedrandom"

export function createRng(seed: string) {
  const rng = seedrandom(seed)
  return {
    float(min = 0, max = 1) {
      return min + (max - min) * rng()
    },
    int(min: number, max: number) {
      return Math.floor(this.float(min, max + 1))
    },
  }
}

