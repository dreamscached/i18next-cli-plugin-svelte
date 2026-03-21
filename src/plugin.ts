import type { Plugin } from "i18next-cli";
import { compile } from "svelte/compiler";

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
		const res = compile(code, { generate: "client" });
		return res.js.code;
	}
}
