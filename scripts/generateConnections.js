import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DATA_DIR = path.join(ROOT, "public", "data");

const normalize = (str) => String(str ?? "").toLowerCase().trim();

const colorGroups = {
  blue: ["blue", "navy", "indigo", "azure"],
  red: ["red", "crimson", "scarlet", "maroon"],
  yellow: ["yellow", "gold", "amber", "ochre"],
  green: ["green", "emerald", "olive", "teal"],
  black: ["black"],
  white: ["white"],
  gray: ["gray", "grey"],
};

function normalizeColor(color) {
  const c = normalize(color);
  for (const group of Object.keys(colorGroups)) {
    if (colorGroups[group].includes(c)) return group;
  }
  return c;
}

function intersection(a, b) {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

function scoreConnection(a, b) {
  let score = 0;
  const reasons = [];

  const sharedThemes = intersection(a.themes || [], b.themes || []);
  if (sharedThemes.length) {
    score += sharedThemes.length * 3;
    reasons.push(...sharedThemes);
  }

  const sharedMood = intersection(a.mood || [], b.mood || []);
  if (sharedMood.length) {
    score += sharedMood.length * 2;
    reasons.push(...sharedMood);
  }

  const colorsA = (a.colors || []).map(normalizeColor);
  const colorsB = (b.colors || []).map(normalizeColor);
  const sharedColors = intersection(colorsA, colorsB);
  if (sharedColors.length) {
    score += sharedColors.length * 1;
    reasons.push(...sharedColors);
  }

  if (a.artist && b.artist && a.artist === b.artist) {
    score += 5;
    reasons.push("same artist");
  }

  const sharedMovement = intersection(a.movement || [], b.movement || []);
  if (sharedMovement.length) {
    score += sharedMovement.length * 3;
    reasons.push(...sharedMovement);
  }

  const sharedPersonal = intersection(a.personalTags || [], b.personalTags || []);
  if (sharedPersonal.length) {
    score += sharedPersonal.length * 2;
    reasons.push(...sharedPersonal);
  }

  return { score, reasons: [...new Set(reasons.map(normalize).filter(Boolean))] };
}

async function main() {
  const artworksPath = path.join(DATA_DIR, "artworks.json");
  const artworks = JSON.parse(await readFile(artworksPath, "utf-8"));

  const connections = [];
  for (let i = 0; i < artworks.length; i++) {
    for (let j = i + 1; j < artworks.length; j++) {
      const a = artworks[i];
      const b = artworks[j];
      const { score, reasons } = scoreConnection(a, b);
      if (score > 2) {
        connections.push({
          source: a.id,
          target: b.id,
          score,
          reasons,
        });
      }
    }
  }

  await mkdir(PUBLIC_DATA_DIR, { recursive: true });
  await writeFile(
    path.join(PUBLIC_DATA_DIR, "connections.json"),
    JSON.stringify(connections, null, 2),
    "utf-8",
  );

  // Keep artworks.json available to the frontend too.
  await copyFile(artworksPath, path.join(PUBLIC_DATA_DIR, "artworks.json"));

  console.log(`Connections generated: ${connections.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

