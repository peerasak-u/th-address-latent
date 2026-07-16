import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface PromotionGate {
	readonly enforced: boolean;
	readonly passed: boolean;
	readonly ablationApplicable?: boolean;
	readonly failures: readonly string[];
	readonly grandfathered?: boolean;
}

interface GeneratedResourceArtifact {
	readonly promotionGate?: PromotionGate;
}

const IMPORT_PATTERN = /resources\/generated\/[\w.-]+\.json/g;

async function findSourceFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await findSourceFiles(path)));
		} else if (/\.(ts|tsx)$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

async function findShippedResourcePaths(): Promise<Set<string>> {
	const paths = new Set<string>();
	for (const root of ["src", "bench"]) {
		for (const file of await findSourceFiles(root)) {
			const contents = await readFile(file, "utf8");
			for (const match of contents.matchAll(IMPORT_PATTERN)) {
				paths.add(match[0]);
			}
		}
	}
	return paths;
}

const shippedResourcePaths = await findShippedResourcePaths();
if (shippedResourcePaths.size === 0) {
	throw new Error("no resources/generated/*.json references found in src/ or bench/");
}

const failures: string[] = [];
for (const path of shippedResourcePaths) {
	const raw = await readFile(path, "utf8").catch(() => null);
	if (raw === null) {
		failures.push(`${path}: referenced but missing on disk`);
		continue;
	}
	const artifact: GeneratedResourceArtifact = JSON.parse(raw);
	const gate = artifact.promotionGate;
	if (!gate) {
		failures.push(`${path}: no promotionGate field (predates the ADR-0002 gate)`);
	} else if (gate.grandfathered) {
		failures.push(`${path}: grandfathered resources cannot be shipped`);
	} else if (!gate.enforced) {
		failures.push(`${path}: promotionGate.enforced is false (built with --skip-gate)`);
	} else if (!gate.passed) {
		failures.push(`${path}: promotionGate.passed is false (lost to noDirections)`);
	} else if (gate.ablationApplicable === false) {
		console.log(`${path}: fit-mode=none, promotionGate.passed reflects the noDirections baseline itself (no ablation was run)`);
	}
}

if (failures.length > 0) {
	console.error("Resource promotion gate check failed:");
	for (const failure of failures) console.error(`  ${failure}`);
	console.error(
		"Rebuild the resource with `bun run build:resources` so it passes the noDirections ablation gate before shipping it.",
	);
	process.exit(1);
}

console.log(`Resource promotion gate check passed for ${shippedResourcePaths.size} resource(s).`);
