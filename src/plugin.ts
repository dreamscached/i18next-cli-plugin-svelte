/* eslint-disable @typescript-eslint/no-explicit-any */
import { generate, GENERATOR } from "astring";
import { walk } from "estree-walker";
import type { Plugin, PluginContext } from "i18next-cli";
import { parse, type AST } from "svelte/compiler";

type AstGenerator = typeof GENERATOR;

/**
 * Enables I18next to extract translation keys from .svelte component files.
 */
export class I18nextPluginSvelte implements Plugin {
	/** i18next-cli plugin name. */
	public readonly name = "i18next-cli-plugin-svelte";
	private readonly generator = this.createTypescriptAstGenerator();

	/**
	 * Creates a new AST generator to process Typescript specific syntax.
	 * @returns an extended astree's {@link GENERATOR} object.
	 */
	private createTypescriptAstGenerator(): AstGenerator {
		return new Proxy(
			{
				...GENERATOR,
				TSAsExpression(node, state) {
					// unwrap 'x as y'
					this[node.expression.type]?.(node.expression, state);
				},
				TSNonNullExpression(node, state) {
					// unwrap 'x!!'
					this[node.expression.type]?.(node.expression, state);
				},
				TSTypeAssertion(node, state) {
					// unwrap '<y> x'
					this[node.expression.type]?.(node.expression, state);
				},
				TSInstantiationExpression(node, state) {
					// unwrap 'const/let x: y = ...'
					this[node.expression.type]?.(node.expression, state);
				},
				TSModuleBlock(node, state) {
					// pass children inside 'declare module {...}'
					for (const statement of node.body) {
						this[statement.type]?.(statement, state);
					}
				}
			},
			{
				/** Catch-all to ignore any TS-prefixed AST nodes if undefined. */
				get(target: AstGenerator, prop: string) {
					if (!(prop in target) && prop.startsWith("TS")) return () => {};
					return target[prop];
				}
			}
		);
	}

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

		const ast = parse(code, { filename: path }) as AST.Root & { html: any };
		const extractedBody: any[] = [];

		// extract from the <script> tag
		if (ast.instance) {
			extractedBody.push(...(ast.instance.content as any).body);
		}
		if (ast.module) {
			extractedBody.push(...(ast.module.content as any).body);
		}

		// extract from HTML
		if (ast.html?.children?.length != 0) {
			walk(ast.html, {
				enter(node: any) {
					if (node.type === "MustacheTag") {
						// Wrap the expression in an ExpressionStatement to make it a valid JS statement
						extractedBody.push({
							type: "ExpressionStatement",
							expression: node.expression
						});
					}
				}
			});
		}

		// This handles rare case when translated strings are
		// used as enum value initializers
		for (let i = extractedBody.length - 1; i >= 0; i--) {
			const thisNode = extractedBody[i];
			if (thisNode.type === "TSEnumDeclaration") {
				extractedBody.splice(i, 1);
				walk(thisNode, {
					enter(node: any) {
						if (node.type === "TSEnumMember") {
							extractedBody.push(node.initializer);
						}
					}
				});
			}
		}

		// When contatenating make sure we don't cause issues with ASI
		// Cast to any to satisfy astring's strict Node typing
		return generate(
			{
				type: "Program",
				body: extractedBody,
				sourceType: "module"
			} as any,
			{
				generator: this.generator
			}
		);
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
		if (node.type !== "VariableDeclarator") return;

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
		const useTranslationNames = context.config.extract.useTranslationNames ?? ["useTranslation"];

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
		const nsNode =
			nsArgIndex !== -1 ? innerCall.arguments?.[nsArgIndex]?.expression : undefined;
		const kpNode =
			kpArgIndex !== -1 ? innerCall.arguments?.[kpArgIndex]?.expression : undefined;

		const defaultNs: string | undefined =
			nsNode?.type === "StringLiteral" ? nsNode.value : undefined;
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
