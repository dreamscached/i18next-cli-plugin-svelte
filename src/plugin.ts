/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as estree from "estree";
import type { Plugin, PluginContext } from "i18next-cli";
import * as recast from "recast";
import { parse, type AST } from "svelte/compiler";

import { extractScriptStatements, extractTemplateStatements, toIIFE } from "./ast.js";

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

		const ast = parse(code, { filename: path }) as AST.Root & { html: AST.Fragment };

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
		if ((ast.html as any)?.children?.length) body.push(...extractTemplateStatements(ast.html));

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
	onVisitNode(node: any, context: PluginContext): void {
		switch (node.type) {
			case "VariableDeclarator":
				this.handleDerivedBy(node, context);
				break;
		}
	}

	private handleDerivedBy(node: any, context: PluginContext) {
		const init = node.init;
		if (!init || init.type !== "CallExpression") return;

		// Detect $derived.by(<inner>) or $derived(<inner>)
		const callee = init.callee;
		let innerCall: any;
		if (
			callee.type === "MemberExpression" &&
			callee.object.type === "Identifier" &&
			callee.object.value === "$derived" &&
			callee.property.type === "Identifier" &&
			callee.property.value === "by"
		) {
			const firstArg = init.arguments?.[0]?.expression;
			if (firstArg?.type === "CallExpression") innerCall = firstArg;
		} else if (callee.type === "Identifier" && callee.value === "$derived") {
			const firstArg = init.arguments?.[0]?.expression;
			if (firstArg?.type === "CallExpression") innerCall = firstArg;
		}

		if (!innerCall || innerCall.callee?.type !== "Identifier") return;

		const hookName: string = innerCall.callee.value;

		// Check if the inner call matches a registered useTranslationNames entry
		// prettier-ignore
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

		const getDefaultNsNode = (node: any) => {
			switch (node?.type) {
				case "StringLiteral":
					return node.value;
				case "ArrayExpression":
					return (() => {
						const expressions = node.elements.map((it: any) => it.expression);
						// prettier-ignore
						const isStringArray = expressions.every((it: any) => it.type === "StringLiteral");
						if (!isStringArray) return undefined;
						return expressions[0]?.value ?? undefined;
					})();
				default:
					return undefined;
			}
		};

		// Extract namespace and keyPrefix from the inner call's arguments
		const nsNode =
			nsArgIndex !== -1 ? innerCall.arguments?.[nsArgIndex]?.expression : undefined;
		const kpNode =
			kpArgIndex !== -1 ? innerCall.arguments?.[kpArgIndex]?.expression : undefined;

		const defaultNs: string | undefined = getDefaultNsNode(nsNode);
		const keyPrefix: string | undefined =
			kpNode?.type === "StringLiteral" ? kpNode.value : undefined;

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
				if (prop.type === "AssignmentPatternProperty" && prop.key.type === "Identifier") {
					context.setVarInScope(prop.key.value, scopeInfo);
				}
				if (prop.type === "KeyValuePatternProperty" && prop.value.type === "Identifier") {
					context.setVarInScope(prop.value.value, scopeInfo);
				}
			}
		} else if (node.id.type === "Identifier") {
			// FIXME: this never fires?
			context.setVarInScope(node.id.value, scopeInfo);
		}
	}
}
