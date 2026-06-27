// Generates a coverage SVG badge from the vitest json-summary report.
// Run after `vitest run --coverage --coverage.reporter=json-summary`, which
// writes coverage/coverage-summary.json. Used by the coverage-badge workflow.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { makeBadge } from "badge-maker";

const SUMMARY_PATH = "coverage/coverage-summary.json";
const BADGE_PATH = ".github/badges/coverage.svg";

function colorFor(pct) {
	if (pct >= 90) return "brightgreen";
	if (pct >= 80) return "green";
	if (pct >= 70) return "yellowgreen";
	if (pct >= 60) return "yellow";
	if (pct >= 50) return "orange";
	return "red";
}

const summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
const pct = summary.total.lines.pct;

const svg = makeBadge({
	label: "coverage",
	message: `${pct}%`,
	color: colorFor(pct)
});

mkdirSync(dirname(BADGE_PATH), { recursive: true });
writeFileSync(BADGE_PATH, svg);

console.log(`Wrote ${BADGE_PATH} (coverage ${pct}%)`);
