import { useMemo, useState } from "react";
import { createAddressParser } from "./parser";
import type { FieldName, ParseResult, ParserResources } from "./types";
import artifact from "../resources/generated/construction-v2-ngram4-d512.json";

const examples = [
	{
		label: "ที่อยู่ครบถ้วน",
		value: "นายทดสอบ ใจดี 081-234-5678 บ้านเลขที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 10330",
	},
	{
		label: "ไม่มีชื่อและเบอร์",
		value: "บ้านเลขที่ 99/12 ถนนพระรามที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 10330",
	},
	{
		label: "รหัสไปรษณีย์ไม่ตรง",
		value: "บ้านเลขที่ 1 ปทุมวัน ปทุมวัน กรุงเทพมหานคร 99999",
	},
] as const;

const fields: ReadonlyArray<{ key: FieldName; label: string }> = [
	{ key: "name", label: "ชื่อผู้รับ" },
	{ key: "phone", label: "โทรศัพท์" },
	{ key: "address", label: "ที่อยู่" },
	{ key: "subdistrict", label: "แขวง / ตำบล" },
	{ key: "district", label: "เขต / อำเภอ" },
	{ key: "province", label: "จังหวัด" },
	{ key: "zipcode", label: "รหัสไปรษณีย์" },
];

const resources = artifact.resources as ParserResources;
const initialInput: string = examples[0].value;

function confidenceLabel(confidence: number): string {
	if (confidence >= 0.8) return "มั่นใจสูง";
	if (confidence >= 0.6) return "มั่นใจปานกลาง";
	if (confidence > 0) return "มั่นใจต่ำ";
	return "ไม่พบข้อมูล";
}

function formatComputeTime(computeMs: number): string {
	return `${computeMs.toFixed(computeMs < 10 ? 2 : 1)} ms`;
}

function ResultPanel({
	result,
	computeMs,
}: {
	result: ParseResult;
	computeMs: number;
}) {
	const confidence = Math.round(result.confidence * 100);

	return (
		<section className="result-panel" aria-live="polite">
			<div className="result-heading">
				<div>
					<p className="eyebrow">ผลการแยกข้อมูล</p>
					<h2>Address record</h2>
				</div>
				<div className="confidence" title={`ความมั่นใจ ${confidence}%`}>
					<strong>{confidence}%</strong>
					<span>{confidenceLabel(result.confidence)}</span>
				</div>
			</div>

			<dl className="field-grid">
				{fields.map(({ key, label }) => (
					<div className="field" key={key}>
						<dt>{label}</dt>
						<dd className={result.fields[key] ? "" : "empty"}>
							{result.fields[key] ?? "—"}
						</dd>
					</div>
				))}
			</dl>

			<div className="diagnostics">
				<span className="compute-time">
					compute {formatComputeTime(computeMs)}
				</span>
				<span>{result.diagnostics.candidatesEvaluated} candidates</span>
				<span>{result.diagnostics.hypothesesEvaluated} hypotheses</span>
				<span>{result.spans.length} fields accepted</span>
			</div>

			{result.abstentions.length > 0 && (
				<p className="abstentions">
					<strong>ละเว้นข้อมูล:</strong>{" "}
					{result.abstentions
						.map(({ field, reason }) => `${field} (${reason})`)
						.join(", ")}
				</p>
			)}
		</section>
	);
}

export function App() {
	const parser = useMemo(() => createAddressParser(resources), []);
	const [draft, setDraft] = useState(initialInput);
	const [submitted, setSubmitted] = useState(initialInput);
	const { result, computeMs } = useMemo(() => {
		const start = performance.now();
		const parsed = parser.parse(submitted);
		return { result: parsed, computeMs: performance.now() - start };
	}, [parser, submitted]);

	function runParser(): void {
		setSubmitted(draft.trim());
	}

	function loadExample(value: string): void {
		setDraft(value);
		setSubmitted(value);
	}

	return (
		<main className="page-shell">
			<header className="hero">
				<div className="brand" aria-label="Thai Address Parser">
					<span className="brand-mark">ท</span>
					<span>
						TH Address <em>latent</em>
					</span>
				</div>
				<div className="hero-copy">
					<p className="eyebrow">Browser playground</p>
					<h1>
						ลองแยกที่อยู่ไทย
						<br />
						ในเบราว์เซอร์
					</h1>
					<p className="lede">
						พิมพ์ข้อความหนึ่งบรรทัด แล้วดูผลลัพธ์จาก candidate scoring, pruning และ
						deterministic validation
					</p>
				</div>
				<div className="resource-note">
					<span className="resource-dot" />
					Frozen resource <strong>{resources.version}</strong>
					<a className="explainer-link" href="explainer.html">How it works ↗</a>
				</div>
			</header>

			<section className="workbench" aria-label="Thai address parser demo">
				<div className="input-panel">
					<div className="panel-heading">
						<div>
							<p className="eyebrow">Input</p>
							<h2>ข้อความที่อยู่</h2>
						</div>
						<span className="character-count">{draft.length} ตัวอักษร</span>
					</div>

					<label className="sr-only" htmlFor="address-input">
						ข้อความที่อยู่ภาษาไทย
					</label>
					<textarea
						id="address-input"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder="เช่น บ้านเลขที่ 1 ปทุมวัน กรุงเทพมหานคร 10330"
						rows={7}
					/>

					<div className="input-actions">
						<button className="run-button" type="button" onClick={runParser}>
							แยกที่อยู่ <span aria-hidden="true">↗</span>
						</button>
						<button
							className="clear-button"
							type="button"
							onClick={() => setDraft("")}
						>
							ล้างข้อความ
						</button>
					</div>

					<div className="example-block">
						<p>ลองตัวอย่าง</p>
						<div className="example-buttons">
							{examples.map((example) => (
								<button
									className="example-button"
									type="button"
									key={example.label}
									onClick={() => loadExample(example.value)}
								>
									{example.label}
								</button>
							))}
						</div>
					</div>
				</div>

				<ResultPanel result={result} computeMs={computeMs} />
			</section>

			<footer>
				<span>Scorer → Pruner → Validator</span>
				<span>Runs fully in your browser</span>
			</footer>
		</main>
	);
}
