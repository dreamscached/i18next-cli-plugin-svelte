import * as recast from "recast";
import { parse, type AST } from "svelte/compiler";
import { describe, expect, it } from "vitest";

import { extractScriptIIFE, extractTemplateExpr as extractTemplateIIFE } from "./ast.js";

describe("extractScriptIIFE", () => {
	it.each([
		{
			source: `
                <script>
                    import { foobar } from "foobar";
                </script>
            `,
			output: `(async () => {
    const {
        foobar
    } = await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    import {} from "foobar";
                </script>
            `,
			output: `(async () => {
    await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    import { foobar as barbaz } from "foobar";
                </script>
            `,
			output: `(async () => {
    const {
        foobar: barbaz
    } = await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    import { foobar as barbaz, bar } from "foobar";
                </script>
            `,
			output: `(async () => {
    const {
        foobar: barbaz,
        bar
    } = await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    import Foobar from "foobar";
                </script>
            `,
			output: `(async () => {
    const {
        default: Foobar
    } = await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    import Foobar, { foobar } from "foobar";
                </script>
            `,
			output: `(async () => {
    const {
        default: Foobar,
        foobar
    } = await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    import "foobar";
                </script>
            `,
			output: `(async () => {
    await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    import * as foobar from "foobar";
                </script>
            `,
			output: `(async () => {
    const foobar = await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    const foobar = await import("foobar");
                </script>
            `,
			output: `(async () => {
    const foobar = await import("foobar");
})();`
		},
		{
			source: `
                <script>
                    if (true) {
                        const foobar = await import("foobar");
                    }
                </script>
            `,
			output: `(async () => {
    if (true) {
        const foobar = await import("foobar");
    }
})();`
		},
		{
			source: `
                <script>
                    export const foobar = 42;
                </script>
            `,
			output: `(async () => {
    const foobar = 42;
})();`
		},
		{
			source: `
                <script>
                    const foobar = 42;
                    export default foobar;
                </script>
            `,
			output: `(async () => {
    const foobar = 42;
    foobar;
})();`
		},
		{
			source: `
                <script>
                    const foo = import.meta.foo;
                </script>
            `,
			output: `(async () => {
    const foo = {}.foo;
})();`
		}
	])("should convert/strip iife-unsafe constructs", ({ source, output }) => {
		const ast = parse(source) as AST.Root;
		const iife = extractScriptIIFE(ast.instance!);
		const js = recast.print(iife).code;
		expect(js).toEqual(output);
	});

	it.each([
		{
			source: `
                {#snippet foobar()}
                {/snippet}
            `,
			output: `(async () => {
    (async () => {})();
})();`
		},
		{
			source: `
                {#snippet foobar(x, y=42, z=fn("bar"))}
                {/snippet}
            `,
			output: `(async () => {
    (async () => {
        fn("bar");
    })();
})();`
		},
		{
			source: `
                {#snippet foobar(x, y=42, z=fn("bar"))}{/snippet}
                {#snippet barbaz(x, y, z)}
                    <div my-attr={fn("bar")}>
                    </div>
                {/snippet}
            `,
			output: `(async () => {
    (async () => {
        fn("bar");
    })();

    (async () => {
        fn("bar");
    })();
})();`
		}
	])("should convert snippet to iife", ({ source, output }) => {
		const ast = parse(source) as AST.Root & { html: AST.Fragment };
		const iife = extractTemplateIIFE(ast.html);
		const js = recast.print(iife).code;
		expect(js).toEqual(output);
	});
});
