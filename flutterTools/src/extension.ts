import * as vscode from 'vscode';
import { generateDartClass } from './generators/dart_model_generator';
import { callDeepSeek } from './deepseek/deepseek';
import * as fs from 'fs';
import * as path from 'path';
import { extractWidgetToFile } from './generators/extract_widget_to_file';

let extensionContextRef: vscode.ExtensionContext | undefined;

export function activate(context: vscode.ExtensionContext) {
	extensionContextRef = context;
	console.log('flutterTools is now active!');

	// 命令: 选择当前 widget
	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.selectCurrentWidget', selectCurrentWidgetFunction)
	);

	// 命令: 生成构造函数
	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.generateConstructorParams', generateConstructorParamsFunction)
	);

	// 命令: 生成 GetX 模块
	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.generateGetXModule', generateGetXModule)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.extractWidgetToFile', extractWidgetToFile)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.wrapWithObx', wrapWithObxFunction)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.wrapWithObxBlock', wrapWithObxBlockFunction)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.wrapWithFutureBuilder', wrapWithFutureBuilderFunction)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.wrapWithLayoutBuilder', wrapWithLayoutBuilderFunction)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.wrapWithGetBuilder', wrapWithGetBuilderFunction)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.selectCurrentFunction', selectCurrentFunctionFunction)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.generateOverrideMethods', generateOverrideMethodsFunction)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.renameFileToSnakeCase', renameFileToSnakeCaseFunction)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('flutterTools.searchFiles', searchProjectFilesFunction)
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				rememberRecentSearchFile(editor.document.uri);
			}
		})
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			{ language: 'dart', scheme: 'file' },
			new DartObxWrapCodeActionProvider(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] }
		)
	);

	// deepSeek 命令，暂时没用
	// let askDeepSeek = vscode.commands.registerCommand('flutterTools.askDeepSeek', askDeepSeekFunction);
	// context.subscriptions.push(askDeepSeek);

}

type WidgetOffsets = {
	start: number;
	end: number;
};

type FunctionOffsets = {
	start: number;
	end: number;
};

type DartClassContext = {
	name: string;
	start: number;
	end: number;
	bodyStart: number;
	bodyEnd: number;
	header: string;
	extendsName?: string;
	stateWidgetType?: string;
	implementsNames: string[];
	methodNames: Set<string>;
	indent: string;
};

type GetXGenerationOption = vscode.QuickPickItem & {
	value?: 'controller' | 'logic' | 'view' | 'widget' | 'page' | 'state' | 'binding';
	group: 'logic' | 'presentation' | 'optional';
};

type QuickPickHighlightRanges = {
	label?: Array<[number, number]>;
	description?: Array<[number, number]>;
	detail?: Array<[number, number]>;
};

type WorkspaceFileQuickPickItem = vscode.QuickPickItem & {
	uri: vscode.Uri;
	highlights?: QuickPickHighlightRanges;
};

const recentSearchFilesStorageKey = 'flutterTools.searchFiles.recentFiles';
const maxRecentSearchFiles = 100;
const maxSearchResultFiles = 200;
const flutterSearchExcludeGlob = '**/{.git,.svn,.hg,.dart_tool,.fvm,.idea,.gradle,build,dist,node_modules,Pods,.symlinks,.plugin_symlinks}/**';
const excludedSearchPathSegments = new Set([
	'.git',
	'.svn',
	'.hg',
	'.dart_tool',
	'.fvm',
	'.idea',
	'.gradle',
	'build',
	'dist',
	'node_modules',
	'Pods',
	'.symlinks',
	'.plugin_symlinks'
]);

function getRememberedSearchValue(storageKey: string): string {
	return extensionContextRef?.workspaceState.get<string>(storageKey) ?? '';
}

function setRememberedSearchValue(storageKey: string, value: string): void {
	void extensionContextRef?.workspaceState.update(storageKey, value);
}

function shouldExcludeFromFileSearch(uri: vscode.Uri): boolean {
	if (uri.scheme !== 'file') {
		return true;
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
	if (!workspaceFolder) {
		return true;
	}

	const relativePath = vscode.workspace.asRelativePath(uri, false);
	const pathSegments = relativePath.split('/');
	return pathSegments.some(segment => excludedSearchPathSegments.has(segment));
}

function rememberRecentSearchFile(uri: vscode.Uri): void {
	if (uri.scheme !== 'file') {
		return;
	}

	if (!vscode.workspace.getWorkspaceFolder(uri)) {
		return;
	}

	if (shouldExcludeFromFileSearch(uri)) {
		return;
	}

	const currentItems = extensionContextRef?.workspaceState.get<string[]>(recentSearchFilesStorageKey) ?? [];
	const nextItems = [uri.fsPath, ...currentItems.filter(item => item !== uri.fsPath)].slice(0, maxRecentSearchFiles);
	void extensionContextRef?.workspaceState.update(recentSearchFilesStorageKey, nextItems);
}

function addHighlightRanges(target: Array<[number, number]>, text: string, terms: string[]): void {
	const lowerText = text.toLowerCase();
	for (const rawTerm of terms) {
		const term = rawTerm.toLowerCase();
		if (!term) {
			continue;
		}

		let searchStart = 0;
		while (searchStart < lowerText.length) {
			const index = lowerText.indexOf(term, searchStart);
			if (index < 0) {
				break;
			}

			target.push([index, index + term.length]);
			searchStart = index + term.length;
		}
	}
}

function mergeHighlightRanges(ranges: Array<[number, number]>): Array<[number, number]> {
	if (ranges.length === 0) {
		return [];
	}

	const sortedRanges = [...ranges].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
	const mergedRanges: Array<[number, number]> = [sortedRanges[0]];

	for (let index = 1; index < sortedRanges.length; index++) {
		const currentRange = sortedRanges[index];
		const previousRange = mergedRanges[mergedRanges.length - 1];
		if (currentRange[0] <= previousRange[1]) {
			previousRange[1] = Math.max(previousRange[1], currentRange[1]);
			continue;
		}

		mergedRanges.push(currentRange);
	}

	return mergedRanges;
}

function getWorkspaceFileQueryTermGroups(query: string): string[][] {
	return getWorkspaceFileQuerySegments(query).map(segment => segment.split(/\s+/).filter(Boolean));
}

function getWorkspaceFileQueryMatches(relativePath: string, query: string): Array<{ pathSegmentIndex: number; terms: string[] }> | undefined {
	const normalizedQuery = normalizeWorkspaceFileSearchQuery(query).toLowerCase();
	if (normalizedQuery === '') {
		return [];
	}

	const querySegments = getWorkspaceFileQueryTermGroups(normalizedQuery);
	const pathSegments = relativePath
		.replace(/\\/g, '/')
		.toLowerCase()
		.split('/')
		.filter(Boolean);

	let startIndex = 0;
	const matches: Array<{ pathSegmentIndex: number; terms: string[] }> = [];
	for (const querySegmentTerms of querySegments) {
		let matched = false;

		for (let index = startIndex; index < pathSegments.length; index++) {
			const pathSegment = pathSegments[index];
			if (querySegmentTerms.every(term => pathSegment.includes(term))) {
				matches.push({ pathSegmentIndex: index, terms: querySegmentTerms });
				matched = true;
				startIndex = index + 1;
				break;
			}
		}

		if (!matched) {
			return undefined;
		}
	}

	return matches;
}

function getWorkspaceFileQuickPickHighlights(relativePath: string, query: string): QuickPickHighlightRanges | undefined {
	const matches = getWorkspaceFileQueryMatches(relativePath, query);
	if (!matches || matches.length === 0) {
		return undefined;
	}

	const originalPathSegments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
	const fileName = originalPathSegments[originalPathSegments.length - 1] ?? '';
	const directorySegments = originalPathSegments.slice(0, -1);
	const labelRanges: Array<[number, number]> = [];
	const descriptionRanges: Array<[number, number]> = [];

	for (const match of matches) {
		if (match.pathSegmentIndex === originalPathSegments.length - 1) {
			addHighlightRanges(labelRanges, fileName, match.terms);
			continue;
		}

		if (match.pathSegmentIndex >= directorySegments.length) {
			continue;
		}

		const segmentText = directorySegments[match.pathSegmentIndex];
		const segmentOffset = directorySegments
			.slice(0, match.pathSegmentIndex)
			.reduce((total, segment) => total + segment.length + 1, 0);
		const segmentRanges: Array<[number, number]> = [];
		addHighlightRanges(segmentRanges, segmentText, match.terms);
		for (const [start, end] of segmentRanges) {
			descriptionRanges.push([segmentOffset + start, segmentOffset + end]);
		}
	}

	const label = mergeHighlightRanges(labelRanges);
	const description = mergeHighlightRanges(descriptionRanges);
	if (label.length === 0 && description.length === 0) {
		return undefined;
	}

	return {
		label: label.length > 0 ? label : undefined,
		description: description.length > 0 ? description : undefined
	};
}

function getMatchedPathDisplay(relativePath: string, query: string): string | undefined {
	const matches = getWorkspaceFileQueryMatches(relativePath, query);
	if (!matches || matches.length === 0) {
		return undefined;
	}

	const originalPathSegments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
	const matchedSegments = matches
		.map(match => originalPathSegments[match.pathSegmentIndex])
		.filter((segment): segment is string => !!segment);

	if (matchedSegments.length <= 1) {
		return undefined;
	}

	return matchedSegments.join('/');
}

function toWorkspaceFileQuickPickItem(uri: vscode.Uri, query = ''): WorkspaceFileQuickPickItem | undefined {
	if (shouldExcludeFromFileSearch(uri)) {
		return undefined;
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
	if (!workspaceFolder) {
		return undefined;
	}

	const relativePath = vscode.workspace.asRelativePath(uri, false);
	const parsedPath = path.parse(relativePath);
	const matchedPathDisplay = getMatchedPathDisplay(relativePath, query);

	return {
		label: parsedPath.base,
		description: matchedPathDisplay ?? relativePath,
		detail: matchedPathDisplay ? `${workspaceFolder.name} • ${relativePath}` : workspaceFolder.name,
		highlights: getWorkspaceFileQuickPickHighlights(relativePath, query),
		alwaysShow: true,
		uri
	};
}

async function getRecentWorkspaceFileSearchItems(): Promise<WorkspaceFileQuickPickItem[]> {
	const recentPaths = extensionContextRef?.workspaceState.get<string[]>(recentSearchFilesStorageKey) ?? [];
	const items = await Promise.all(recentPaths.map(async filePath => {
		const uri = vscode.Uri.file(filePath);
		try {
			await vscode.workspace.fs.stat(uri);
			return toWorkspaceFileQuickPickItem(uri);
		} catch {
			return undefined;
		}
	}));

	return items.filter((item): item is WorkspaceFileQuickPickItem => !!item);
}

function normalizeWorkspaceFileSearchQuery(query: string): string {
	return query.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function getWorkspaceFileQuerySegments(query: string): string[] {
	return normalizeWorkspaceFileSearchQuery(query)
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean);
}

function buildWorkspaceFileSearchGlob(query: string): string {
	const segments = getWorkspaceFileQuerySegments(query);
	if (segments.length === 0) {
		return '**/*';
	}

	const lastSegment = segments[segments.length - 1];
	const lastSegmentPattern = lastSegment.split(/\s+/).filter(Boolean).join('*');
	if (lastSegmentPattern === '') {
		return '**/*';
	}

	return `**/*${lastSegmentPattern}*`;
}

async function searchWorkspaceFilesByQuery(query: string): Promise<WorkspaceFileQuickPickItem[]> {
	const fileUris = await vscode.workspace.findFiles(buildWorkspaceFileSearchGlob(query), flutterSearchExcludeGlob, maxSearchResultFiles);
	const items = fileUris
		.map(uri => {
			const relativePath = vscode.workspace.asRelativePath(uri, false);
			return getWorkspaceFileQueryMatches(relativePath, query) ? uri : undefined;
		})
		.filter((uri): uri is vscode.Uri => !!uri)
		.map(uri => toWorkspaceFileQuickPickItem(uri, query))
		.filter((item): item is WorkspaceFileQuickPickItem => !!item);

	return items.sort((left, right) => left.label.localeCompare(right.label) || (left.description ?? '').localeCompare(right.description ?? ''));
}

async function searchProjectFilesFunction() {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		vscode.window.showErrorMessage('Open a workspace folder first.');
		return;
	}

	const storageKey = 'flutterTools.searchFiles.lastQuery';
	const recentItems = await getRecentWorkspaceFileSearchItems();

	const selectedItem = await new Promise<WorkspaceFileQuickPickItem | undefined>(resolve => {
		const quickPick = vscode.window.createQuickPick<WorkspaceFileQuickPickItem>();
		quickPick.title = 'Flutter Tools Search Files';
		quickPick.placeholder = '搜索项目文件，空输入时显示最近打开文件';
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;
		quickPick.items = recentItems;
		quickPick.value = getRememberedSearchValue(storageKey);

		let searchTimer: NodeJS.Timeout | undefined;
		let activeSearchId = 0;

		const updateItems = async (value: string) => {
			const query = value.trim();
			if (query === '') {
				quickPick.busy = false;
				quickPick.items = recentItems;
				return;
			}

			const searchId = ++activeSearchId;
			quickPick.busy = true;
			const foundItems = await searchWorkspaceFilesByQuery(query);
			if (searchId !== activeSearchId) {
				return;
			}

			quickPick.busy = false;
			quickPick.items = foundItems;
		};

		// 保留上一次输入的查询内容，下次打开时直接恢复。
		quickPick.onDidChangeValue(value => {
			setRememberedSearchValue(storageKey, value);
			if (searchTimer) {
				clearTimeout(searchTimer);
			}
			searchTimer = setTimeout(() => {
				void updateItems(value);
			}, 120);
		});

		let resolved = false;
		const finish = (item: WorkspaceFileQuickPickItem | undefined) => {
			if (resolved) {
				return;
			}
			resolved = true;
			if (searchTimer) {
				clearTimeout(searchTimer);
			}
			setRememberedSearchValue(storageKey, quickPick.value);
			quickPick.dispose();
			resolve(item);
		};

		quickPick.onDidAccept(() => {
			finish(quickPick.selectedItems[0]);
		});

		quickPick.onDidHide(() => {
			finish(undefined);
		});

		quickPick.show();
		void updateItems(quickPick.value);
	});

	if (!selectedItem) {
		return;
	}

	try {
		await vscode.commands.executeCommand('vscode.open', selectedItem.uri);
		rememberRecentSearchFile(selectedItem.uri);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		vscode.window.showErrorMessage(`Open file failed: ${message}`);
	}
}

function toSnakeCaseText(value: string): string {
	return value
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[\s-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}

function findWidgetOffsets(text: string, cursorOffset: number, includeTrailingComma: boolean): WidgetOffsets | undefined {
	const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));
	const rightChar = safeOffset < text.length ? text[safeOffset] : '';
	const leftChar = safeOffset > 0 ? text[safeOffset - 1] : '';

	let widgetStartParen = -1;
	let rightParenOffset = -1;

	if (rightChar === ')') {
		rightParenOffset = safeOffset;
	} else if (leftChar === ')') {
		rightParenOffset = safeOffset - 1;
	}

	if (rightParenOffset >= 0) {
		let depth = 0;
		for (let i = rightParenOffset; i >= 0; i--) {
			if (text[i] === ')') {
				depth++;
			} else if (text[i] === '(') {
				depth--;
				if (depth === 0) {
					widgetStartParen = i;
					break;
				}
			}
		}
	} else {
		let i = safeOffset;
		while (i > 0 && text[i] !== '(') {
			i--;
		}
		if (text[i] === '(') {
			widgetStartParen = i;
		}
	}

	if (widgetStartParen < 0) {
		return undefined;
	}

	let start = widgetStartParen;
	let i = widgetStartParen - 1;
	while (i >= 0 && /\s/.test(text[i])) {
		i--;
	}

	let angleDepth = 0;
	for (; i >= 0; i--) {
		const ch = text[i];

		if (ch === '>') {
			angleDepth++;
			continue;
		}

		if (ch === '<') {
			if (angleDepth > 0) {
				angleDepth--;
				continue;
			}
			break;
		}

		if (angleDepth > 0) {
			continue;
		}

		if (/[a-zA-Z0-9_.]/.test(ch)) {
			continue;
		}

		break;
	}

	start = i + 1;

	let end = safeOffset;
	let openParen = 0;
	let foundStart = false;

	for (let i = start; i < text.length; i++) {
		if (text[i] === '(') {
			openParen++;
			foundStart = true;
		} else if (text[i] === ')') {
			openParen--;
		}

		if (foundStart && openParen === 0) {
			end = i + 1;
			break;
		}
	}

	if (includeTrailingComma && end < text.length && text[end] === ',') {
		end += 1;
	}

	if (end <= start) {
		return undefined;
	}

	return { start, end };
}

function getGetImportInsertPosition(document: vscode.TextDocument): vscode.Position {
	let lastImportLine = -1;
	for (let i = 0; i < document.lineCount; i++) {
		const lineText = document.lineAt(i).text.trim();
		if (lineText.startsWith('import ')) {
			lastImportLine = i;
		}
	}

	if (lastImportLine >= 0) {
		return document.lineAt(lastImportLine).range.end;
	}

	return new vscode.Position(0, 0);
}

function findFunctionOffsets(text: string, cursorOffset: number): FunctionOffsets | undefined {
	const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));
	// 匹配 Dart 函数头：支持注解、返回类型、泛型参数、命名参数({})、async、块函数/箭头函数。
	const functionRegex = /(^|\n)\s*(?:@[^\n]+\n\s*)*(?:[A-Za-z_][\w<>,\?\s\[\]\.]*\s+)?([A-Za-z_]\w*)\s*(?:<[^>{}\n]*>)?\s*\([^;]*\)\s*(?:async\s*)?(=>|{)/gm;
	const excluded = new Set(['if', 'for', 'while', 'switch', 'catch']);

	let best: FunctionOffsets | undefined;
	let match: RegExpExecArray | null;

	while ((match = functionRegex.exec(text)) !== null) {
		const leading = match[1] ?? '';
		const name = match[2];
		if (!name || excluded.has(name)) {
			continue;
		}

		const start = match.index + leading.length;
		const matchText = match[0].slice(leading.length);
		const isArrow = match[3] === '=>';

		let end = -1;
		if (isArrow) {
			// 箭头函数以分号结尾，选中到 ;
			const arrowIndex = start + matchText.lastIndexOf('=>');
			const semicolonIndex = text.indexOf(';', arrowIndex + 2);
			if (semicolonIndex < 0) {
				continue;
			}
			end = semicolonIndex + 1;
		} else {
			// 块函数按大括号深度配对，选中到对应 }
			const braceOpenIndex = start + matchText.lastIndexOf('{');
			let depth = 0;
			for (let i = braceOpenIndex; i < text.length; i++) {
				if (text[i] === '{') {
					depth++;
				} else if (text[i] === '}') {
					depth--;
					if (depth === 0) {
						end = i + 1;
						break;
					}
				}
			}
			if (end < 0) {
				continue;
			}
		}

		if (safeOffset < start || safeOffset > end) {
			continue;
		}

		// 光标命中多个函数时，优先最小包围范围（通常是最内层函数）
		if (!best || (end - start) < (best.end - best.start)) {
			best = { start, end };
		}
	}

	return best;
}

function stripTypeArgs(typeName: string): string {
	return typeName.replace(/<[^>]*>/g, '').trim();
}

function findCurrentClassContext(text: string, cursorOffset: number): DartClassContext | undefined {
	const classRegex = /\bclass\s+([A-Za-z_]\w*)[^\{]*\{/g;
	let match: RegExpExecArray | null;

	while ((match = classRegex.exec(text)) !== null) {
		const className = match[1];
		const fullMatch = match[0];
		const classStart = match.index;
		const openBrace = classStart + fullMatch.lastIndexOf('{');

		let depth = 0;
		let closeBrace = -1;
		for (let i = openBrace; i < text.length; i++) {
			if (text[i] === '{') {
				depth++;
			} else if (text[i] === '}') {
				depth--;
				if (depth === 0) {
					closeBrace = i;
					break;
				}
			}
		}

		if (closeBrace < 0) {
			continue;
		}

		if (cursorOffset < classStart || cursorOffset > closeBrace + 1) {
			continue;
		}

		const header = text.slice(classStart, openBrace);
		const bodyText = text.slice(openBrace + 1, closeBrace);

		const extendsMatch = header.match(/\bextends\s+([A-Za-z_]\w*(?:<[^>]+>)?)/);
		const extendsName = extendsMatch?.[1];
		const extendsBase = extendsName ? stripTypeArgs(extendsName) : undefined;

		const stateWidgetMatch = extendsName?.match(/^State<\s*([A-Za-z_]\w*)\s*>$/);
		const stateWidgetType = stateWidgetMatch?.[1];

		const implementsMatch = header.match(/\bimplements\s+([^\{]+)/);
		const implementsNames = (implementsMatch?.[1] ?? '')
			.split(',')
			.map(name => stripTypeArgs(name))
			.map(name => name.trim())
			.filter(Boolean);

		const methodNames = new Set<string>();
		const methodRegex = /(?:@override\s+)?(?:static\s+)?(?:[\w<>,\?\[\]\s\.]+\s+)?([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:async\s*)?(?:=>|\{)/g;
		let methodMatch: RegExpExecArray | null;
		while ((methodMatch = methodRegex.exec(bodyText)) !== null) {
			if (methodMatch[1]) {
				methodNames.add(methodMatch[1]);
			}
		}

		const classLineStart = text.lastIndexOf('\n', classStart - 1) + 1;
		const classIndent = (text.slice(classLineStart, classStart).match(/^[ \t]*/) ?? [''])[0];
		const indentMatch = bodyText.match(/\n([ \t]+)\S/);
		const indent = indentMatch?.[1] ?? `${classIndent}  `;

		return {
			name: className,
			start: classStart,
			end: closeBrace + 1,
			bodyStart: openBrace + 1,
			bodyEnd: closeBrace,
			header,
			extendsName: extendsBase,
			stateWidgetType,
			implementsNames,
			methodNames,
			indent
		};
	}

	return undefined;
}

function getOverrideCandidates(ctx: DartClassContext): Array<{ name: string; body: string }> {
	const widgetType = ctx.stateWidgetType ?? 'Widget';
	const candidates: Array<{ name: string; body: string }> = [];
	const baseName = ctx.extendsName ?? '';

	const add = (name: string, body: string) => {
		if (!ctx.methodNames.has(name)) {
			candidates.push({ name, body });
		}
	};

	if (baseName === 'StatelessWidget' || baseName === 'GetView' || baseName === 'GetWidget' || baseName === 'GetResponsiveView') {
		add('build', `@override\nWidget build(BuildContext context) {\n  return const SizedBox.shrink();\n}`);
	}

	if (baseName === 'StatefulWidget') {
		add('createState', `@override\nState<${ctx.name}> createState() => _${ctx.name}State();`);
	}

	if (baseName === 'State') {
		add('initState', '@override\nvoid initState() {\n  super.initState();\n}');
		add('didChangeDependencies', '@override\nvoid didChangeDependencies() {\n  super.didChangeDependencies();\n}');
		add('didUpdateWidget', `@override\nvoid didUpdateWidget(covariant ${widgetType} oldWidget) {\n  super.didUpdateWidget(oldWidget);\n}`);
		add('reassemble', '@override\nvoid reassemble() {\n  super.reassemble();\n}');
		add('deactivate', '@override\nvoid deactivate() {\n  super.deactivate();\n}');
		add('dispose', '@override\nvoid dispose() {\n  super.dispose();\n}');
		add('build', `@override\nWidget build(BuildContext context) {\n  return const SizedBox.shrink();\n}`);
	}

	if (baseName === 'GetxController') {
		add('onInit', '@override\nvoid onInit() {\n  super.onInit();\n}');
		add('onReady', '@override\nvoid onReady() {\n  super.onReady();\n}');
		add('onClose', '@override\nvoid onClose() {\n  super.onClose();\n}');
	}

	if (baseName === 'ChangeNotifier') {
		add('dispose', '@override\nvoid dispose() {\n  super.dispose();\n}');
	}

	if (ctx.implementsNames.includes('WidgetsBindingObserver')) {
		add('didChangeAppLifecycleState', '@override\nvoid didChangeAppLifecycleState(AppLifecycleState state) {}');
		add('didHaveMemoryPressure', '@override\nvoid didHaveMemoryPressure() {}');
	}

	if (ctx.implementsNames.includes('PreferredSizeWidget')) {
		add('preferredSize', '@override\nSize get preferredSize => const Size.fromHeight(kToolbarHeight);');
	}

	if (ctx.implementsNames.includes('RouteAware')) {
		add('didPopNext', '@override\nvoid didPopNext() {}');
		add('didPush', '@override\nvoid didPush() {}');
		add('didPop', '@override\nvoid didPop() {}');
		add('didPushNext', '@override\nvoid didPushNext() {}');
	}

	if (candidates.length === 0) {
		add('toString', `@override\nString toString() {\n  return '${ctx.name}()';\n}`);
		add('operator ==', `@override\nbool operator ==(Object other) {\n  if (identical(this, other)) return true;\n  return other is ${ctx.name};\n}`);
		add('hashCode', '@override\nint get hashCode => runtimeType.hashCode;');
	}

	return candidates;
}

function indentBlock(code: string, indent: string): string {
	return code
		.split('\n')
		.map(line => `${indent}${line}`)
		.join('\n');
}

class DartObxWrapCodeActionProvider implements vscode.CodeActionProvider {
	provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
		if (document.languageId !== 'dart') {
			return [];
		}

		const hasSelection = !range.isEmpty;
		const canDetectWidget = !!findWidgetOffsets(document.getText(), document.offsetAt(range.start), true);
		const canDetectFunction = !!findFunctionOffsets(document.getText(), document.offsetAt(range.start));
		const canDetectClass = !!findCurrentClassContext(document.getText(), document.offsetAt(range.start));
		// 只有能确定目标时才展示 Rewrite 动作，减少无效噪音。
		if (!hasSelection && !canDetectWidget && !canDetectFunction && !canDetectClass) {
			return [];
		}

		const action = new vscode.CodeAction('Wrap with Obx', vscode.CodeActionKind.RefactorRewrite);
		action.command = {
			command: 'flutterTools.wrapWithObx',
			title: 'Wrap with Obx'
		};

		const blockAction = new vscode.CodeAction('Wrap with Obx (block)', vscode.CodeActionKind.RefactorRewrite);
		blockAction.command = {
			command: 'flutterTools.wrapWithObxBlock',
			title: 'Wrap with Obx (block)'
		};

		const futureBuilderAction = new vscode.CodeAction('Wrap with FutureBuilder', vscode.CodeActionKind.RefactorRewrite);
		futureBuilderAction.command = {
			command: 'flutterTools.wrapWithFutureBuilder',
			title: 'Wrap with FutureBuilder'
		};

		const layoutBuilderAction = new vscode.CodeAction('Wrap with LayoutBuilder', vscode.CodeActionKind.RefactorRewrite);
		layoutBuilderAction.command = {
			command: 'flutterTools.wrapWithLayoutBuilder',
			title: 'Wrap with LayoutBuilder'
		};

		const getBuilderAction = new vscode.CodeAction('Wrap with GetBuilder', vscode.CodeActionKind.RefactorRewrite);
		getBuilderAction.command = {
			command: 'flutterTools.wrapWithGetBuilder',
			title: 'Wrap with GetBuilder'
		};

		const selectFunctionAction = new vscode.CodeAction('Select Current Function', vscode.CodeActionKind.RefactorRewrite);
		selectFunctionAction.command = {
			command: 'flutterTools.selectCurrentFunction',
			title: 'Select Current Function'
		};

		const overrideMethodsAction = new vscode.CodeAction('Generate Override Methods', vscode.CodeActionKind.RefactorRewrite);
		overrideMethodsAction.command = {
			command: 'flutterTools.generateOverrideMethods',
			title: 'Generate Override Methods'
		};

		return [
			action,
			blockAction,
			futureBuilderAction,
			layoutBuilderAction,
			getBuilderAction,
			selectFunctionAction,
			overrideMethodsAction
		];
	}
}

async function generateOverrideMethodsFunction() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No active editor');
		return;
	}

	const document = editor.document;
	if (document.languageId !== 'dart') {
		vscode.window.showInformationMessage('Generate Override Methods only supports Dart files.');
		return;
	}

	const cursorOffset = document.offsetAt(editor.selection.active);
	const ctx = findCurrentClassContext(document.getText(), cursorOffset);
	if (!ctx) {
		vscode.window.showInformationMessage('No class found at cursor.');
		return;
	}

	const candidates = getOverrideCandidates(ctx);
	if (candidates.length === 0) {
		vscode.window.showInformationMessage('No override candidates found for current class.');
		return;
	}

	const picks = await vscode.window.showQuickPick(
		candidates.map(item => ({ label: item.name, description: 'override', candidate: item })),
		{
			canPickMany: true,
			placeHolder: 'Select methods to override'
		}
	);

	if (!picks || picks.length === 0) {
		return;
	}

	const blocks = picks.map(p => indentBlock(p.candidate.body, ctx.indent));
	const insertionText = `\n\n${blocks.join('\n\n')}\n`;
	const isCursorInsideClassBody = cursorOffset >= ctx.bodyStart && cursorOffset <= ctx.bodyEnd;
	const insertPos = isCursorInsideClassBody
		? editor.selection.active
		: document.positionAt(ctx.bodyEnd);

	const ok = await editor.edit(editBuilder => {
		editBuilder.insert(insertPos, insertionText);
	});

	if (!ok) {
		vscode.window.showErrorMessage('Generate Override Methods failed.');
		return;
	}

	vscode.window.showInformationMessage('Override methods generated.');
}

function selectCurrentFunctionFunction() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No active editor');
		return;
	}

	const document = editor.document;
	const cursorOffset = document.offsetAt(editor.selection.active);
	// 选中函数签名+实现体，覆盖返回值、函数名、参数与函数体。
	const offsets = findFunctionOffsets(document.getText(), cursorOffset);

	if (!offsets) {
		vscode.window.showInformationMessage('No function found at cursor.');
		return;
	}

	const startPos = document.positionAt(offsets.start);
	const endPos = document.positionAt(offsets.end);
	editor.selection = new vscode.Selection(startPos, endPos);
	editor.revealRange(new vscode.Range(startPos, endPos));
	vscode.window.showInformationMessage('Function selected.');
}

async function wrapWithObxFunction() {
	await wrapWithObxByStyle('arrow');
}

async function wrapWithObxBlockFunction() {
	await wrapWithObxByStyle('block');
}

async function wrapWithFutureBuilderFunction() {
	await wrapWithTemplate({
		buildWrappedText: (body, suffix) => `FutureBuilder<dynamic>(\n  future: null,\n  builder: (context, snapshot) {\n    if (snapshot.connectionState == ConnectionState.waiting) {\n      return const CircularProgressIndicator();\n    }\n    return ${body};\n  },\n)${suffix}`,
		successMessage: 'Wrapped with FutureBuilder.'
	});
}

async function wrapWithLayoutBuilderFunction() {
	await wrapWithTemplate({
		buildWrappedText: (body, suffix) => `LayoutBuilder(\n  builder: (context, constraints) {\n    return ${body};\n  },\n)${suffix}`,
		successMessage: 'Wrapped with LayoutBuilder.'
	});
}

async function wrapWithGetBuilderFunction() {
	await wrapWithTemplate({
		buildWrappedText: (body, suffix) => `GetBuilder<dynamic>(\n  builder: (controller) {\n    return ${body};\n  },\n)${suffix}`,
		successMessage: 'Wrapped with GetBuilder.',
		requireGetImport: true
	});
}

function splitTrailingComma(text: string): { body: string; hasTrailingComma: boolean } {
	const match = text.match(/,(\s*)$/);
	if (!match || match.index === undefined) {
		return { body: text, hasTrailingComma: false };
	}

	return {
		body: text.slice(0, match.index).trimEnd(),
		hasTrailingComma: true
	};
}

function resolveWrapTargetRange(editor: vscode.TextEditor): vscode.Range | undefined {
	const document = editor.document;
	const selection = editor.selection;

	if (!selection.isEmpty) {
		return selection;
	}

	const offsets = findWidgetOffsets(document.getText(), document.offsetAt(selection.active), true);
	if (!offsets) {
		return undefined;
	}

	return new vscode.Range(document.positionAt(offsets.start), document.positionAt(offsets.end));
}

type WrapTemplateOptions = {
	buildWrappedText: (body: string, suffix: string) => string;
	successMessage: string;
	requireGetImport?: boolean;
};

async function wrapWithTemplate(options: WrapTemplateOptions) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No active editor');
		return;
	}

	const document = editor.document;
	if (document.languageId !== 'dart') {
		vscode.window.showInformationMessage('Wrap only supports Dart files.');
		return;
	}

	const targetRange = resolveWrapTargetRange(editor);
	if (!targetRange) {
		vscode.window.showInformationMessage('No widget found at cursor.');
		return;
	}

	const selectedText = document.getText(targetRange);
	if (!selectedText.trim()) {
		vscode.window.showInformationMessage('No widget found at cursor.');
		return;
	}

	const parsed = splitTrailingComma(selectedText);
	const suffix = parsed.hasTrailingComma ? ',' : '';
	const wrapped = options.buildWrappedText(parsed.body, suffix);

	const hasGetImport = /import\s+['"]package:get\/get\.dart['"];/.test(document.getText());
	const importInsertPos = options.requireGetImport && !hasGetImport
		? getGetImportInsertPosition(document)
		: undefined;

	const ok = await editor.edit(editBuilder => {
		if (importInsertPos) {
			const importText = importInsertPos.line === 0 && importInsertPos.character === 0
				? `import 'package:get/get.dart';\n\n`
				: `\nimport 'package:get/get.dart';`;
			editBuilder.insert(importInsertPos, importText);
		}
		editBuilder.replace(targetRange, wrapped);
	});

	if (!ok) {
		vscode.window.showErrorMessage('Wrap failed.');
		return;
	}

	vscode.window.showInformationMessage(options.successMessage);
}

async function wrapWithObxByStyle(style: 'arrow' | 'block') {
	await wrapWithTemplate({
		buildWrappedText: (body, suffix) => style === 'arrow'
			? `Obx(() => ${body})${suffix}`
			: `Obx(() {\n  return ${body};\n})${suffix}`,
		successMessage: style === 'arrow' ? 'Wrapped with Obx.' : 'Wrapped with Obx (block).',
		requireGetImport: true
	});
}

async function askDeepSeekFunction() {
	vscode.window.showInformationMessage('敬请期待 DeepSeek AI 的回答。');
	// 	const editor = vscode.window.activeTextEditor;
	// 	if (!editor) return;

	// 	const selected = editor.document.getText(editor.selection);
	// 	if (!selected) {
	// 		vscode.window.showInformationMessage('Please select some code or text.');
	// 		return;
	// 	}

	// 	vscode.window.showInformationMessage('Asking DeepSeek...');

	// 	const answer = await callDeepSeek([
	// 		{ role: 'system', content: '你是一个 Flutter/Dart 智能编程助手。' },
	// 		{ role: 'user', content: `请解释或优化以下 Dart 代码：\n\n${selected}` }
	// 	]);

	// 	vscode.window.showInformationMessage('DeepSeek responded (see Output).');

	// 	const html = await getHtmlContent(answer);
	// 	const panel = vscode.window.createWebviewPanel('markdownPreview', 'DeepSeek AI Output', vscode.ViewColumn.Beside, {});
	// 	panel.webview.html = html;


	// 	async function getHtmlContent(markdown: string): Promise<string> {
	// 		const { marked } = await import('marked');
	// 		const html = marked(markdown);
	// 		return `
	// <!DOCTYPE html>
	// <html>
	// <head>
	//   <meta charset="utf-8">
	//   <style>
	//     body { font-family: sans-serif; padding: 16px; }
	//     pre { background: #f6f8fa; padding: 10px; }
	//     code { font-family: monospace; }
	//   </style>
	// </head>
	// <body>
	//   ${html}
	// </body>
	// </html>`;
	// 	}
}

async function pickGetXGenerationOptions(): Promise<GetXGenerationOption[] | undefined> {
	const options: GetXGenerationOption[] = [
		{ label: '逻辑层', kind: vscode.QuickPickItemKind.Separator, group: 'logic' },
		{ label: 'Controller', value: 'controller', description: '默认', detail: '生成 xxx_controller.dart', picked: true, group: 'logic' },
		{ label: 'Logic', value: 'logic', detail: '生成 xxx_logic.dart', group: 'logic' },
		{ label: '展示层', kind: vscode.QuickPickItemKind.Separator, group: 'presentation' },
		{ label: 'View', value: 'view', description: '默认', detail: '生成 xxx_view.dart', picked: true, group: 'presentation' },
		{ label: 'Widget', value: 'widget', detail: '生成 xxx_widget.dart', group: 'presentation' },
		{ label: 'Page', value: 'page', detail: '生成 xxx_page.dart，带 Scaffold', group: 'presentation' },
		{ label: '可选文件', kind: vscode.QuickPickItemKind.Separator, group: 'optional' },
		{ label: 'State', value: 'state', detail: '生成 xxx_state.dart', group: 'optional' },
		{ label: 'Binding', value: 'binding', detail: '生成 xxx_binding.dart', group: 'optional' }
	];

	return await new Promise<GetXGenerationOption[] | undefined>(resolve => {
		const quickPick = vscode.window.createQuickPick<GetXGenerationOption>();
		quickPick.title = '生成 GetX 模块';
		quickPick.placeholder = '选择要生成的文件';
		quickPick.canSelectMany = true;
		quickPick.items = options;

		const selectableOptions = options.filter(option => option.kind !== vscode.QuickPickItemKind.Separator);
		const optionByValue = new Map(
			selectableOptions
				.filter((option): option is GetXGenerationOption & { value: NonNullable<GetXGenerationOption['value']> } => !!option.value)
				.map(option => [option.value, option])
		);
		let currentSelectedItems = selectableOptions.filter(option => option.picked);
		let isUpdatingSelection = false;
		let didAccept = false;
		let isResolved = false;

		quickPick.selectedItems = currentSelectedItems;

		const disposeAndResolve = (value: GetXGenerationOption[] | undefined) => {
			if (isResolved) {
				return;
			}
			isResolved = true;
			quickPick.dispose();
			resolve(value);
		};

		quickPick.onDidChangeSelection(items => {
			if (isUpdatingSelection) {
				return;
			}

			const addedItems = items.filter(item => !currentSelectedItems.some(selected => selected.value === item.value));
			const nextSelection = [...items];

			for (const addedItem of addedItems) {
				if (addedItem.group === 'optional') {
					continue;
				}

				for (let index = nextSelection.length - 1; index >= 0; index--) {
					const candidate = nextSelection[index];
					if (candidate.group === addedItem.group && candidate.value !== addedItem.value) {
						nextSelection.splice(index, 1);
					}
				}
			}

			const hasChanged = nextSelection.length !== items.length || nextSelection.some((item, index) => item.value !== items[index]?.value);
			currentSelectedItems = nextSelection;

			if (hasChanged) {
				isUpdatingSelection = true;
				quickPick.selectedItems = nextSelection.map(item => item.value ? (optionByValue.get(item.value) ?? item) : item);
				isUpdatingSelection = false;
			}
		});

		quickPick.onDidAccept(() => {
			didAccept = true;
			disposeAndResolve([...quickPick.selectedItems]);
		});
		quickPick.onDidHide(() => {
			if (!didAccept) {
				disposeAndResolve(undefined);
			}
		});
		quickPick.show();
	});
}

async function renameFileToSnakeCaseFunction(uri?: vscode.Uri) {
	if (!uri) {
		vscode.window.showErrorMessage('请在文件或文件夹上右键后使用该命令。');
		return;
	}

	const filePath = uri.fsPath;
	let fileStat: vscode.FileStat | undefined;
	try {
		fileStat = await vscode.workspace.fs.stat(uri);
	} catch {
		fileStat = undefined;
	}

	if (!fileStat || (fileStat.type !== vscode.FileType.File && fileStat.type !== vscode.FileType.Directory)) {
		vscode.window.showInformationMessage('该命令仅支持文件或文件夹。');
		return;
	}

	const isDirectory = fileStat.type === vscode.FileType.Directory;
	const currentName = isDirectory ? path.basename(filePath) : path.parse(filePath).name;
	const extension = isDirectory ? '' : path.extname(filePath);
	const parentDir = path.dirname(filePath);
	const nextBaseName = toSnakeCaseText(currentName);
	if (!nextBaseName) {
		vscode.window.showInformationMessage('无法生成有效的新名称。');
		return;
	}

	if (nextBaseName === currentName) {
		vscode.window.showInformationMessage(isDirectory ? '文件夹名已经是下划线小写格式。' : '文件名已经是下划线小写格式。');
		return;
	}

	const targetPath = path.join(parentDir, `${nextBaseName}${extension}`);
	const targetUri = vscode.Uri.file(targetPath);
	let targetExists = false;
	try {
		await vscode.workspace.fs.stat(targetUri);
		targetExists = true;
	} catch {
		targetExists = false;
	}

	if (targetExists) {
		vscode.window.showErrorMessage(`目标已存在：${nextBaseName}${extension}`);
		return;
	}

	await vscode.workspace.fs.rename(uri, targetUri);
	vscode.window.showInformationMessage(`已重命名为：${nextBaseName}${extension}`);
}

// 生成 GetX 模块
async function generateGetXModule(uri?: vscode.Uri) {
	if (!uri) {
		vscode.window.showErrorMessage('请在目录上右键创建 GetX Module');
		return;
	}
	function toSnakeCase(str: string): string {
		return toSnakeCaseText(str);
	}

	function toPascalCase(str: string): string {
		if (str.includes('_')) {
			// 下划线转 PascalCase
			return str
				.toLowerCase()
				.split('_')
				.map(word => word.charAt(0).toUpperCase() + word.slice(1))
				.join('');
		} else {
			// 驼峰或 PascalCase，首字母大写即可，保持后续大小写不变
			return str.charAt(0).toUpperCase() + str.slice(1);
		}
	}


	const moduleNameInput = await vscode.window.showInputBox({
		prompt: 'Enter module name (snake_case or camelCase allowed)',
		placeHolder: 'e.g. user_profile or userProfile',
	});
	if (!moduleNameInput) {
		return;
	}

	const generationSelections = await pickGetXGenerationOptions();

	if (!generationSelections) {
		// Esc/cancel: do nothing and never create files.
		return;
	}

	const selectedTypes = new Set(generationSelections.flatMap(item => item.value ? [item.value] : []));
	const selectedLogicTypes = generationSelections.filter(item => item.group === 'logic' && item.value);
	const selectedPresentationTypes = generationSelections.filter(item => item.group === 'presentation' && item.value);

	if (selectedLogicTypes.length !== 1) {
		vscode.window.showInformationMessage('请选择且仅选择一个逻辑层类型：controller 或 logic。');
		return;
	}

	if (selectedPresentationTypes.length !== 1) {
		vscode.window.showInformationMessage('请选择且仅选择一个展示层类型：view、widget 或 page。');
		return;
	}

	const logicType = selectedLogicTypes[0];
	const presentationType = selectedPresentationTypes[0];

	const snakeName = toSnakeCase(moduleNameInput); // 转下划线
	const pascalName = toPascalCase(moduleNameInput); // 转驼峰

	// 获取工作区根目录
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showErrorMessage('Open a workspace folder first.');
		return;
	}
	// const rootPath = workspaceFolders[0].uri.fsPath;

	// 目标目录：lib/modules/{snake_name}
	// const moduleDir = path.join(rootPath, 'lib', 'pages', snakeName);

	const targetDir = uri.fsPath; // 👈 被右键的目录
	// console.log('Create GetX Module at:', targetDir);

	// // 让用户输入模块名
	// const moduleName = await vscode.window.showInputBox({
	// 	prompt: '请输入 GetX 模块名称（snake_case）',
	// });

	// if (!moduleName) return;

  const moduleDir = path.join(targetDir, '', '', snakeName);

	if (!fs.existsSync(moduleDir)) {
		fs.mkdirSync(moduleDir, { recursive: true });
	}

	const shouldGenerateState = selectedTypes.has('state');
	const shouldGenerateBinding = selectedTypes.has('binding');
	const logicValue = logicType.value ?? 'controller';
	const presentationValue = presentationType.value ?? 'view';
	const logicFileSuffix = logicValue;
	const logicClassSuffix = logicValue === 'logic' ? 'Logic' : 'Controller';
	const logicFileName = `${snakeName}_${logicFileSuffix}.dart`;
	const logicClassName = `${pascalName}${logicClassSuffix}`;
	const presentationFileSuffix = presentationValue;
	const presentationClassSuffix = toPascalCase(presentationValue);
	const presentationFileName = `${snakeName}_${presentationFileSuffix}.dart`;
	const presentationClassName = `${pascalName}${presentationClassSuffix}`;
	const widgetBaseClass = presentationValue === 'widget' ? 'GetWidget' : 'GetView';

	// 各文件内容模版
	const stateFile = shouldGenerateState ? `import '${snakeName}_state.dart';` : '';
	const initState = shouldGenerateState ? `final state = ${pascalName}State();` : '';
	const controllerContent = `import 'package:get/get.dart';
${stateFile}
class ${logicClassName} extends GetxController {
  // TODO: Implement ${logicClassSuffix}
  ${initState}
}
`;
	
	const getState = shouldGenerateState ? `${pascalName}State get state => controller.state;` : '';
	const initPresentation = `const ${presentationClassName}({super.key});`;
	const bodyContent = presentationValue === 'page'
		? `return Scaffold(\n      appBar: AppBar(\n        title: Text('${pascalName}'),\n        centerTitle: true,\n      ),\n      body: Container(),\n    );`
		: 'return Container();';
	const viewContent = `import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '${logicFileName}';
${stateFile}

class ${presentationClassName} extends ${widgetBaseClass}<${logicClassName}> {
	${initPresentation}
   ${getState}
  @override
  Widget build(BuildContext context) {
	    ${bodyContent}
  }
}
`;

	const bindingContent = `import 'package:get/get.dart';
import '${logicFileName}';

class ${pascalName}Binding extends Bindings {
  @override
  void dependencies() {
	    Get.lazyPut<${logicClassName}>(() => ${logicClassName}());
  }
}
`;

	const stateContent = `class ${pascalName}State {
  // Define your state variables here
}
`;

	// 写文件方法
	function writeFile(filename: string, content: string) {
		const filePath = path.join(moduleDir, filename);
		if (fs.existsSync(filePath)) {
			vscode.window.showWarningMessage(`File ${filename} already exists, skipped.`);
			return;
		}
		fs.writeFileSync(filePath, content, { encoding: 'utf8' });
		if (filename.endsWith('_view.dart') ||
			filename.endsWith('_widget.dart') ||
			filename.endsWith('_page.dart')) {
			vscode.window.showInformationMessage(`Created ${moduleDir}/${filename}`,'Open').then(async (selection) => {
				if (selection === 'Open') {
				const doc = await vscode.workspace.openTextDocument(filePath);
				await vscode.window.showTextDocument(doc);
				}
			});
		}
		
	}

	// 生成必须文件
	writeFile(logicFileName, controllerContent);
	writeFile(presentationFileName, viewContent);

	// 生成可选文件
	if (shouldGenerateBinding) {
		writeFile(`${snakeName}_binding.dart`, bindingContent);
	}
	if (shouldGenerateState) {
		writeFile(`${snakeName}_state.dart`, stateContent);
	}
}


// 生成 Dart Model
async function generateModelFromJsonFunction() {

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('No active editor found!');
		return;
	}

	const selection = editor.selection;
	const jsonText = editor.document.getText(selection).trim();

	if (!jsonText) {
		vscode.window.showErrorMessage('Please select JSON text first.');
		return;
	}

	let jsonObject: any;
	try {
		jsonObject = JSON.parse(jsonText);
	} catch (e) {
		vscode.window.showErrorMessage('Selected text is not valid JSON.');
		return;
	}

	let defaultClassName = 'MyModel';

	if (editor && !editor.document.isUntitled) {
		const fileName = editor.document.fileName;
		const baseName = fileName.split(/[/\\]/).pop()?.replace(/\..+$/, '') ?? '';

		if (baseName) {
			// 转为 PascalCase：test_user => TestUser
			defaultClassName = baseName
				.split('_')
				.map(part => part.charAt(0).toUpperCase() + part.slice(1))
				.join('');
		}
	}

	const className = await vscode.window.showInputBox({
		prompt: 'Enter Dart class name',
		value: defaultClassName,
		validateInput: text => text ? null : 'Class name cannot be empty'
	});

	if (!className) {
		vscode.window.showErrorMessage('Class name is required.');
		return;
	}

	// 生成 Dart 代码（支持嵌套）
	const dartCode = generateDartClass(className, jsonObject);

	// 插入到当前文档末尾
	const lastLine = editor.document.lineCount;
	editor.edit(editBuilder => {
		editBuilder.insert(new vscode.Position(lastLine, 0), '\n\n' + dartCode + '\n');
	});

	vscode.window.showInformationMessage(`Dart model '${className}' generated successfully!`);

}

// 选择当前 widget
function selectCurrentWidgetFunction() {

	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No active editor');
		return;
	}

	const document = editor.document;
	const position = editor.selection.active;
	const text = document.getText();
	const offsets = findWidgetOffsets(text, document.offsetAt(position), true);

	if (!offsets) {
		vscode.window.showInformationMessage('No widget found at cursor.');
		return;
	}

	const start = offsets.start;
	const end = offsets.end;

	if (end > start) {
		const startPos = document.positionAt(start);
		const endPos = document.positionAt(end);

		editor.selection = new vscode.Selection(startPos, endPos);
		editor.revealRange(new vscode.Range(startPos, endPos));

		vscode.window.showInformationMessage('Widget selected.');
	} else {
		vscode.window.showInformationMessage('No widget found at cursor.');
	}

}

// 生成构造函数
function generateConstructorParamsFunction() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showErrorMessage('No active editor');
		return;
	}

	const document = editor.document;
	const selection = editor.selection;
	const fullText = document.getText();
	const cursorOffset = document.offsetAt(selection.active);

	// 匹配当前类
	const classRegex = /class\s+(\w+)\s*\{([\s\S]*?)\}/g;
	let match;
	let selectedClassName = '';
	let matchedClassBody = '';

	while ((match = classRegex.exec(fullText)) !== null) {
		const start = match.index;
		const end = classRegex.lastIndex;
		if (cursorOffset >= start && cursorOffset <= end) {
			selectedClassName = match[1];
			matchedClassBody = match[2];
			break;
		}
	}

	if (!selectedClassName || !matchedClassBody) {
		vscode.window.showErrorMessage('No Dart class found at cursor.');
		return;
	}

	// 匹配字段名
	const fieldRegex = /final\s+[\w<>\?]+\s+(\w+);/g;
	const fields: string[] = [];
	let fieldMatch;
	while ((fieldMatch = fieldRegex.exec(matchedClassBody)) !== null) {
		fields.push(`required this.${fieldMatch[1]},`);
	}

	if (fields.length === 0) {
		vscode.window.showInformationMessage('No final fields found.');
		return;
	}

	const result =
		`${selectedClassName}({\n` +
		fields.map(f => `  ${f}`).join('\n') +
		`\n});`;

	editor.edit(editBuilder => {
		editBuilder.insert(selection.active, result);
	});

	vscode.window.showInformationMessage(`Constructor for ${selectedClassName} inserted.`);
}