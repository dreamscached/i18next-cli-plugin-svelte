import type * as estree from "estree";
import { walk } from "estree-walker";
import { type AST } from "svelte/compiler";

/**
 * Minimal shape of the (legacy) Svelte template nodes we read a JS expression
 * from. `parse()` returns the legacy AST, but Svelte 5 only ships types for its
 * modern AST, so we describe the handful of fields we actually touch ourselves.
 */
interface SvelteExpressionNode {
	type:
		| "MustacheTag"
		| "RawMustacheTag"
		| "HtmlTag"
		| "RenderTag"
		| "AttachTag"
		| "ConstTag"
		| "IfBlock"
		| "EachBlock"
		| "KeyBlock"
		| "AwaitBlock";
	expression: estree.Expression;
}

/**
 * Rewrites a Svelte `<script>` AST into IIFE-safe statements: top-level
 * `import`/`export`/`import.meta` constructs are converted to forms that are
 * legal inside a function body. The returned statements are *not* wrapped - use
 * {@link toIIFE} (or {@link extractScriptIIFE}) to do that.
 */
export function extractScriptStatements(script: AST.Script): estree.Statement[] {
	// `script.content` is an estree `Program`, so the walk is fully typed. We
	// can't have top-level 'import ...' declarations in an IIFE, so we convert
	// them to 'const {} = await import' (and strip exports) first.
	walk(script.content, {
		enter(node) {
			switch (node.type) {
				case "ImportDeclaration":
					this.replace(transformImport(node));
					break;
				case "MetaProperty":
					this.replace(transformImportMeta(node));
					break;
				case "ExportNamedDeclaration":
				case "ExportDefaultDeclaration":
					this.replace(transformExport(node));
					break;
			}
		}
	});

	// Imports/exports have been rewritten into statements above, so the body no
	// longer contains ModuleDeclarations despite what the static type says.
	return script.content.body as unknown as estree.Statement[];
}

/**
 * Collects the JS expressions embedded in a Svelte template fragment (mustache
 * tags, logic blocks, attribute/snippet expressions) as statements. Snippets
 * are converted to their own nested IIFEs so their parameter scope is honoured.
 */
export function extractTemplateStatements(fragment: AST.Fragment): estree.ExpressionStatement[] {
	const statements: estree.ExpressionStatement[] = [];

	// estree-walker is typed for estree, but the Svelte template tree is happily
	// walkable all the same; we narrow each node to the legacy shapes we read.
	walk(fragment as unknown as estree.Node, {
		enter(node) {
			const svelteNode = node as unknown as SvelteExpressionNode | AST.SnippetBlock;
			switch (svelteNode.type) {
				case "MustacheTag":
				case "RawMustacheTag":
				case "HtmlTag":
				case "RenderTag":
				case "AttachTag":
				case "ConstTag":
				case "IfBlock":
				case "EachBlock":
				case "KeyBlock":
				case "AwaitBlock":
					statements.push({
						type: "ExpressionStatement",
						expression: svelteNode.expression
					});
					break;
				case "SnippetBlock":
					statements.push(transformSnippet(svelteNode));
					this.remove();
					break;
			}
		}
	});

	return statements;
}

export function extractScriptIIFE(script: AST.Script): estree.ExpressionStatement {
	return toIIFE(extractScriptStatements(script));
}

export function extractTemplateExpr(fragment: AST.Fragment): estree.ExpressionStatement {
	return toIIFE(extractTemplateStatements(fragment));
}

function transformImport(
	node: estree.ImportDeclaration
): estree.VariableDeclaration | estree.ExpressionStatement {
	// 'await import(...)' expression common for any imports
	const awaitExpression: estree.AwaitExpression = {
		type: "AwaitExpression",
		argument: {
			type: "ImportExpression",
			source: node.source
		}
	};

	// Handle side-effect only imports: import "foobar";
	if (node.specifiers.length === 0) {
		return {
			type: "ExpressionStatement",
			expression: awaitExpression
		};
	}

	// Handle namespace import: import * as Foobar
	const namespaceSpecifier = node.specifiers.find((s) => s.type === "ImportNamespaceSpecifier");
	let id: estree.Identifier | estree.ObjectPattern;

	if (namespaceSpecifier) {
		id = namespaceSpecifier.local;
	} else {
		// Handle named and default imports
		const properties = node.specifiers
			.map((specifier) => {
				switch (specifier.type) {
					case "ImportSpecifier":
						return {
							type: "Property" as const,
							key: specifier.imported,
							value: specifier.local,
							kind: "init" as const,
							shorthand:
								specifier.imported.type === "Identifier" &&
								specifier.imported.name === specifier.local.name,
							method: false,
							computed: false
						};
					case "ImportDefaultSpecifier":
						return {
							type: "Property" as const,
							key: { type: "Identifier" as const, name: "default" },
							value: specifier.local,
							kind: "init" as const,
							shorthand: false,
							method: false,
							computed: false
						};
					case "ImportNamespaceSpecifier":
					default:
						return null;
				}
			})
			.filter((val) => val !== null);

		id = {
			type: "ObjectPattern",
			properties: properties
		};
	}

	return {
		type: "VariableDeclaration",
		kind: "const",
		declarations: [
			{
				type: "VariableDeclarator",
				id: id,
				init: awaitExpression
			}
		]
	};
}

export function toIIFE(nodes: estree.Statement[]): estree.ExpressionStatement {
	return {
		type: "ExpressionStatement",
		expression: {
			type: "CallExpression",
			arguments: [],
			optional: false,
			callee: {
				type: "ArrowFunctionExpression",
				params: [],
				expression: false,
				async: true,
				body: {
					type: "BlockStatement",
					body: nodes
				}
			}
		}
	};
}

function transformExport(
	exportNode: estree.ExportNamedDeclaration | estree.ExportDefaultDeclaration
): estree.Statement {
	// Named exports: export const x = 1; export function f() {}
	if (exportNode.type === "ExportNamedDeclaration") {
		if (exportNode.declaration) {
			// Simply return the declaration (const/let/var/function/class)
			// The 'export' keyword is effectively stripped here.
			return exportNode.declaration;
		}

		// Handle: export { x }; (references only, no logic to extract)
		return { type: "EmptyStatement" };
	}

	// Default Exports: export default ...
	const decl = exportNode.declaration;

	// Handle Function/Class Declarations (which might be anonymous)
	if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
		if (decl.id) {
			return decl as estree.Statement;
		}

		// If anonymous, we convert to an expression to satisfy 'Statement' type
		return {
			type: "ExpressionStatement",
			expression: {
				...decl,
				type: decl.type === "FunctionDeclaration" ? "FunctionExpression" : "ClassExpression"
			} as estree.FunctionExpression | estree.ClassExpression
		};
	}

	// Expressions: export default t('key'); or export default { a: t('b') };
	// Wrap in an ExpressionStatement to keep it as a valid Statement in the IIFE body
	return {
		type: "ExpressionStatement",
		expression: decl as estree.Expression
	};
}

function transformImportMeta(node: estree.Node): estree.Node {
	if (node.type === "MetaProperty" && node.meta.name === "import") {
		// Replace with a dummy object {}
		return { type: "ObjectExpression", properties: [] };
	}
	return node;
}

function transformSnippet(snippet: AST.SnippetBlock): estree.ExpressionStatement {
	const statements: estree.Statement[] = [];

	// Collect any call expressions inside the snippet (parameter defaults and
	// body) - that's where translation calls live. The CallExpression nodes are
	// estree-shaped, so the walk is typed once we cross the Svelte boundary.
	walk(snippet as unknown as estree.Node, {
		enter(node) {
			if (node.type === "CallExpression") {
				statements.push({
					type: "ExpressionStatement",
					expression: node
				});
			}
		}
	});

	return toIIFE(statements);
}
