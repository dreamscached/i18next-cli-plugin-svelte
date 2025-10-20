import { type Plugin } from "i18next-cli";
import { parse, type AST } from "svelte/compiler";

const i18nextSveltePlugin: Plugin = {
	name: "i18next-cli-plugin-svelte",
	onLoad: (code: string, path: string) => {
		// Passthrough for non-Svelte files
		if (!path.match(/\.svelte$/)) return code;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const fromAst = (node: any) => code.slice(node.content.start, node.content.end);

		const ast = parse(code, { filename: path }) as AST.Root;
		const extracted: string[] = [];
		if (ast.instance) extracted.push(fromAst(ast.instance));
		if (ast.module) extracted.push(fromAst(ast.module));

		// When contatenating make sure we don't cause issues with ASI
		return extracted.join("\n;");
	}
};

export default i18nextSveltePlugin;
