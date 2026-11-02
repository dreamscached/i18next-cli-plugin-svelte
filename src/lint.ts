import type { I18nextToolkitConfig, LintIssue } from "i18next-cli";
import { recommendedAcceptedAttributes, recommendedAcceptedTags } from "i18next-cli";
import { parse, type AST } from "svelte/compiler";

/** Tags whose content is never linted; mirrors i18next-cli's JSX linter defaults. */
const DEFAULT_IGNORED_TAGS = ["script", "style", "code"];

/** Same directive i18next-cli honours in JS/TS: suppresses issues on the next line. */
const IGNORE_DIRECTIVE = /i18next-instrument-ignore(?:-next-line)?/;

/**
 * Keys of Svelte AST nodes that hold child fragments: element `fragment`,
 * `{#if}` `consequent`/`alternate`, `{#each}` `body`/`fallback`,
 * `{#await}` `pending`/`then`/`catch`, `{#snippet}` `body`.
 */
const FRAGMENT_KEYS = [
	"fragment",
	"consequent",
	"alternate",
	"body",
	"fallback",
	"pending",
	"then",
	"catch"
] as const;

interface ElementLike {
	type: string;
	name: string;
	attributes: Array<AST.Attribute | { type: string }>;
	fragment: AST.Fragment;
}

interface LintOptions {
	ignoredTags: Set<string>;
	acceptedTags: Set<string> | null;
	acceptedAttributes: Set<string> | null;
	ignoredAttributes: Set<string>;
}

/**
 * Resolves lint options the way i18next-cli does for JSX: `lint.*` wins over
 * `extract.*`, which wins over the recommended defaults. `acceptedTags: "all"`
 * (supported by newer i18next-cli versions) disables tag filtering.
 */
export function resolveLintOptions(config: I18nextToolkitConfig): LintOptions {
	const lower = (list: readonly string[] | undefined) => list?.map((s) => s.toLowerCase());
	const { lint, extract } = config;

	const transComponents = lower(extract.transComponents) ?? ["trans"];
	const ignoredTags = new Set([
		...DEFAULT_IGNORED_TAGS,
		...transComponents,
		...(lower(lint?.ignoredTags ?? extract.ignoredTags) ?? [])
	]);

	const tags: unknown = lint?.acceptedTags ?? extract.acceptedTags ?? recommendedAcceptedTags;
	const acceptedTags = Array.isArray(tags)
		? tags.length > 0
			? new Set(tags.map((s: string) => s.toLowerCase()))
			: null
		: null;

	const attrs =
		lower(lint?.acceptedAttributes ?? extract.acceptedAttributes) ??
		lower(recommendedAcceptedAttributes);

	return {
		ignoredTags,
		acceptedTags,
		acceptedAttributes: attrs && attrs.length > 0 ? new Set(attrs) : null,
		ignoredAttributes: new Set(lower(lint?.ignoredAttributes ?? extract.ignoredAttributes))
	};
}

/**
 * Finds user-facing text written directly into Svelte markup: text nodes,
 * string-literal mustaches (`{"text"}`) and static values of translatable
 * attributes (`aria-label="Close"`). Expressions such as `{t("key")}` are not
 * reported. Line numbers refer to the original `.svelte` source.
 */
export function findHardcodedStrings(
	code: string,
	filename: string,
	options: LintOptions
): LintIssue[] {
	const ast = parse(code, { filename, modern: true });
	const issues: LintIssue[] = [];

	const lineStarts = [0];
	for (let i = 0; i < code.length; i++) if (code[i] === "\n") lineStarts.push(i + 1);
	const lineOf = (offset: number) => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid]! <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};

	const report = (raw: string, offset: number) => {
		const text = raw.trim();
		if (!isTranslatable(text)) return;
		issues.push({ text, line: lineOf(offset + raw.indexOf(text)), type: "hardcoded" });
	};

	// Text is linted when no ancestor element is ignored and, if acceptedTags
	// is set, the nearest enclosing element is accepted (as for JSX).
	const textAllowed = (tag: string | null) =>
		options.acceptedTags === null || (tag !== null && options.acceptedTags.has(tag));
	// Attribute-only mode: acceptedAttributes set explicitly without acceptedTags.
	const lintText = !(options.acceptedAttributes && !options.acceptedTags);

	const visitAttributes = (element: ElementLike, tag: string) => {
		if (!textAllowed(tag)) return;
		for (const attr of element.attributes) {
			if (attr.type !== "Attribute") continue;
			const { name, value } = attr as AST.Attribute;
			const lowerName = name.toLowerCase();
			const linted = options.acceptedAttributes
				? options.acceptedAttributes.has(lowerName)
				: !options.ignoredAttributes.has(lowerName);
			if (!linted || value === true) continue;

			for (const part of Array.isArray(value) ? value : [value]) {
				if (part.type === "Text") report(part.data, part.start);
				else if (isStringLiteral(part.expression)) {
					report(part.expression.value, part.expression.start);
				}
			}
		}
	};

	const visit = (node: unknown, tag: string | null): void => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach((child) => visit(child, tag));

		const n = node as { type?: string; nodes?: unknown[] };
		if (n.type === "Fragment") return visit(n.nodes, tag);

		if (n.type === "Text") {
			if (lintText && textAllowed(tag)) report((n as AST.Text).data, (n as AST.Text).start);
			return;
		}

		if (n.type === "ExpressionTag") {
			const expression = (n as AST.ExpressionTag).expression;
			if (lintText && textAllowed(tag) && isStringLiteral(expression)) {
				report(expression.value, expression.start);
			}
			return;
		}

		let current = tag;
		if (isElementLike(n)) {
			current = n.name.toLowerCase();
			if (options.ignoredTags.has(current)) return;
			visitAttributes(n, current);
		}
		for (const key of FRAGMENT_KEYS) visit((n as Record<string, unknown>)[key], current);
	};

	visit(ast.fragment, null);

	const ignoredLines = new Set<number>();
	code.split("\n").forEach((line, i) => {
		if (IGNORE_DIRECTIVE.test(line)) ignoredLines.add(i + 2);
	});
	return issues.filter((issue) => !ignoredLines.has(issue.line));
}

/** Same filters i18next-cli applies to JSX text: no single chars, numbers, URLs or `{{…}}`. */
function isTranslatable(text: string): boolean {
	return (
		text.length > 1 &&
		text !== "..." &&
		!/^(https|http|\/\/|\/)/.test(text) &&
		isNaN(Number(text)) &&
		!text.startsWith("{{")
	);
}

function isElementLike(node: object): node is ElementLike {
	return (
		"name" in node &&
		typeof node.name === "string" &&
		"attributes" in node &&
		Array.isArray(node.attributes) &&
		"fragment" in node
	);
}

function isStringLiteral(
	expression: unknown
): expression is { type: "Literal"; value: string; start: number } {
	const e = expression as { type?: string; value?: unknown } | null;
	return e?.type === "Literal" && typeof e.value === "string";
}
