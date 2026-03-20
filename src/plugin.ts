/* eslint-disable @typescript-eslint/no-explicit-any */
import { walk } from "estree-walker";
import type { Plugin } from "i18next-cli";
import { parse, type AST } from "svelte/compiler";

/**
 * Enables I18next to extract translation keys from .svelte component files.
 */
export class I18nextPluginSvelte implements Plugin {
	/** i18next-cli plugin name. */
	public readonly name = "i18next-cli-plugin-svelte";

	/**
	 * For every .svelte input file attempts component compilation
	 * to i18next-parseable JS source code file for further key
	 * extraction.
	 * @param code raw source code to process
	 * @param path path to the source file
	 * @returns generated JS code from .svelte component or
	 *   undefined for non-Svelte files
	 */
	onLoad(code: string, path: string): string | undefined {
		// Passthrough for non-Svelte files
		if (!path.match(/\.svelte$/)) return undefined;

		const fromAst = (node: any) => code.slice(node.content.start, node.content.end);
		const fromEstree = (node: any) =>
			node.type === "MustacheTag"
				? `(${code.slice(node.expression.start, node.expression.end)})`
				: undefined;

		const ast = parse(code, { filename: path }) as AST.Root & { html: any };
		const extracted: string[] = [];

		// extract from the <script> tag
		if (ast.instance) extracted.push(fromAst(ast.instance));
		if (ast.module) extracted.push(fromAst(ast.module));

		// extract from HTML
		if (ast.html?.children?.length != 0) {
			walk(ast.html, {
				enter(node) {
					const stmt = fromEstree(node);
					if (stmt) extracted.push(stmt);
				}
			});
		}

		// When contatenating make sure we don't cause issues with ASI
		return extracted.join("\n;");
	}
}
