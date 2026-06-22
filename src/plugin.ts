import type { CallExpression, Expression, VariableDeclarator } from "@swc/types";
import type * as estree from "estree";
import type { Plugin, PluginContext } from "i18next-cli";
import * as recast from "recast";
import { parse, type AST } from "svelte/compiler";

import { extractScriptStatements, extractTemplateStatements, toIIFE } from "./ast.js";

/**
 * The node type passed to {@link Plugin.onVisitNode}. i18next-cli walks an
 * `@swc/core` AST; deriving the type from the plugin interface keeps our public
 * surface in sync with it without pinning a specific `@swc` version here.
 */
type VisitorNode = Parameters<NonNullable<Plugin["onVisitNode"]>>[0];

/**
 * Svelte's `parse()` returns the *legacy* AST, whose root exposes `html` (a
 * fragment with `children`) instead of the modern `fragment`/`nodes`. Svelte 5
 * only ships types for the modern AST, so we describe the legacy bits we use.
 */
type LegacyRoot = AST.Root & { html: AST.Fragment & { children: unknown[] } };

/**
 * Enables I18next to extract translation keys from .svelte component files.
 */
export class I18nextPluginSvelte implements Plugin {
	/** i18next-cli plugin name. */
	public readonly name = "i18next-cli-plugin-svelte";

	/**
	 * Extracts JS code from Svelte component `<script>` or `<script module>`,
	 * Svelte templates and attribute value expressions.
	 *
	 * @param code raw source code to process
	 * @param path path to the source file
	 * @returns extracted JS code from .svelte component or
	 *   `undefined` for non-Svelte files
	 */
	onLoad(code: string, path: string): string | undefined {
		// Passthrough for non-Svelte files
		if (!path.match(/\.svelte$/)) return undefined;

		const ast = parse(code, { filename: path }) as unknown as LegacyRoot;

		// Reassemble everything into a single async IIFE. Sharing one lexical
		// scope mirrors how Svelte runs a component (the template and instance
		// can see module-level declarations), which lets the extractor resolve
		// scoped namespaces/keyPrefixes declared in <script> from usages in the
		// template. The async wrapper also makes top-level `await import(...)`
		// (rewritten from `import` statements) legal.
		const body: estree.Statement[] = [];

		// Order matters: declarations must precede the template usages that
		// reference them. Module scope encloses instance scope encloses template.
		if (ast.module) body.push(...extractScriptStatements(ast.module));
		if (ast.instance) body.push(...extractScriptStatements(ast.instance));

		// extract from HTML (mustache tags, svelte blocks, attribute exprs, snippets)
		if (ast.html.children.length) body.push(...extractTemplateStatements(ast.html));

		const program: estree.Program = {
			type: "Program",
			sourceType: "module",
			body: [toIIFE(body)]
		};

		return recast.print(program).code;
	}

	/**
	 * Unwraps Svelte 5 rune wrappers (`$derived.by` and `$derived`) around
	 * `useTranslation`-style hooks so the extractor can resolve the
	 * `namespace` and `keyPrefix` that would otherwise be lost.
	 *
	 * @see https://github.com/dreamscached/i18next-cli-plugin-svelte/issues/5
	 * @see https://github.com/i18next/i18next-cli/issues/231
	 */
	onVisitNode(node: VisitorNode, context: PluginContext): void {
		if (node.type === "VariableDeclarator") {
			this.handleDerivedBy(node as VariableDeclarator, context);
		}
	}

	private handleDerivedBy(node: VariableDeclarator, context: PluginContext): void {
		const init = node.init;
		if (!init || init.type !== "CallExpression") return;

		const innerCall = unwrapDerived(init);
		if (!innerCall || innerCall.callee.type !== "Identifier") return;

		const hookName = innerCall.callee.value;

		// Check if the inner call matches a registered useTranslationNames entry
		const useTranslationNames = context.config.extract.useTranslationNames;
		if (!useTranslationNames) return;

		let nsArgIndex = 0;
		let kpArgIndex = 1;
		let matched = false;

		for (const item of useTranslationNames) {
			if (typeof item === "string" && item === hookName) {
				matched = true;
				break;
			}
			if (typeof item === "object" && item.name === hookName) {
				nsArgIndex = item.nsArg ?? 0;
				kpArgIndex = item.keyPrefixArg ?? 1;
				matched = true;
				break;
			}
		}

		if (!matched) return;

		// Extract namespace and keyPrefix from the inner call's arguments
		const nsNode = nsArgIndex !== -1 ? innerCall.arguments[nsArgIndex]?.expression : undefined;
		const kpNode = kpArgIndex !== -1 ? innerCall.arguments[kpArgIndex]?.expression : undefined;

		const defaultNs = resolveNamespace(nsNode);
		const keyPrefix = kpNode?.type === "StringLiteral" ? kpNode.value : undefined;

		if (!defaultNs && !keyPrefix) return;

		// Build scope info, only including defined properties
		// (required by exactOptionalPropertyTypes)
		const scopeInfo = {
			...(defaultNs ? { defaultNs } : {}),
			...(keyPrefix ? { keyPrefix } : {})
		};

		// Register destructured variables in scope
		if (node.id.type === "ObjectPattern") {
			for (const prop of node.id.properties) {
				if (prop.type === "AssignmentPatternProperty") {
					context.setVarInScope(prop.key.value, scopeInfo);
				} else if (
					prop.type === "KeyValuePatternProperty" &&
					prop.value.type === "Identifier"
				) {
					context.setVarInScope(prop.value.value, scopeInfo);
				}
			}
		} else if (node.id.type === "Identifier") {
			// Non-destructured assignment, e.g. const i18n = $derived.by(...)
			context.setVarInScope(node.id.value, scopeInfo);
		}
	}
}

/**
 * Unwraps a `$derived(<inner>)` or `$derived.by(<inner>)` call, returning the
 * inner call expression (e.g. `useTranslation(...)`) when present.
 */
function unwrapDerived(init: CallExpression): CallExpression | undefined {
	const callee = init.callee;

	const isDerived =
		(callee.type === "Identifier" && callee.value === "$derived") ||
		(callee.type === "MemberExpression" &&
			callee.object.type === "Identifier" &&
			callee.object.value === "$derived" &&
			callee.property.type === "Identifier" &&
			callee.property.value === "by");

	if (!isDerived) return undefined;

	const firstArg = init.arguments[0]?.expression;
	return firstArg?.type === "CallExpression" ? firstArg : undefined;
}

/**
 * Resolves a namespace argument to its string value. Accepts a plain string
 * literal or an array of string literals (fallback namespaces), in which case
 * the first entry wins.
 *
 * @see https://github.com/dreamscached/i18next-cli-plugin-svelte/issues/15
 */
function resolveNamespace(node: Expression | undefined): string | undefined {
	if (node?.type === "StringLiteral") return node.value;
	if (node?.type !== "ArrayExpression") return undefined;

	const elements = node.elements.map((it) => it?.expression);
	const first = elements[0];
	const allStrings = elements.every((it) => it?.type === "StringLiteral");
	return allStrings && first?.type === "StringLiteral" ? first.value : undefined;
}
