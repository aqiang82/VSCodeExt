export type VariableWatchMode = 'read' | 'write' | 'both';

export type FieldWatchInstrumentation = {
	start: number;
	end: number;
	replacement: string;
	fieldName: string;
	markerId: string;
	readBreakpointOffset: number;
	writeBreakpointOffset: number;
};

export type ExistingFieldWatch = {
	start: number;
	end: number;
	originalText: string;
	fieldName: string;
	markerId: string;
	readBreakpointOffset: number;
	writeBreakpointOffset: number;
};

export type VariableReferenceKind = {
	read: boolean;
	write: boolean;
	rxValueWrite: boolean;
};

function isIdentifierCharacter(value: string): boolean {
	return /[A-Za-z0-9_$]/.test(value);
}

function createCodeMask(text: string): Uint8Array {
	const mask = new Uint8Array(text.length);
	let index = 0;

	while (index < text.length) {
		if (text.startsWith('//', index)) {
			index += 2;
			while (index < text.length && text[index] !== '\n') {
				index++;
			}
			continue;
		}

		if (text.startsWith('/*', index)) {
			index += 2;
			let depth = 1;
			while (index < text.length && depth > 0) {
				if (text.startsWith('/*', index)) {
					depth++;
					index += 2;
				} else if (text.startsWith('*/', index)) {
					depth--;
					index += 2;
				} else {
					index++;
				}
			}
			continue;
		}

		const quote = text[index];
		if (quote === '\'' || quote === '"') {
			const rawPrefixIndex = index - 1;
			const isRaw =
				rawPrefixIndex >= 0 &&
				(text[rawPrefixIndex] === 'r' || text[rawPrefixIndex] === 'R') &&
				(rawPrefixIndex === 0 || !isIdentifierCharacter(text[rawPrefixIndex - 1]));
			const delimiterLength = text.startsWith(quote.repeat(3), index) ? 3 : 1;
			index += delimiterLength;

			while (index < text.length) {
				if (text.startsWith(quote.repeat(delimiterLength), index)) {
					index += delimiterLength;
					break;
				}
				if (!isRaw && text[index] === '\\') {
					index += Math.min(2, text.length - index);
				} else {
					index++;
				}
			}
			continue;
		}

		mask[index] = 1;
		index++;
	}

	return mask;
}

function hasIdentifierAt(text: string, mask: Uint8Array, index: number, identifier: string): boolean {
	if (!text.startsWith(identifier, index)) {
		return false;
	}
	for (let offset = 0; offset < identifier.length; offset++) {
		if (!mask[index + offset]) {
			return false;
		}
	}
	return (
		!isIdentifierCharacter(text[index - 1] ?? '') &&
		!isIdentifierCharacter(text[index + identifier.length] ?? '')
	);
}

function skipTriviaForward(text: string, mask: Uint8Array, start: number): number {
	let index = start;
	while (index < text.length && (!mask[index] || /\s/.test(text[index]))) {
		index++;
	}
	return index;
}

function skipTriviaBackward(text: string, mask: Uint8Array, start: number): number {
	let index = start;
	while (index >= 0 && (!mask[index] || /\s/.test(text[index]))) {
		index--;
	}
	return index;
}

function findMatchingBrace(text: string, mask: Uint8Array, openBrace: number): number {
	let depth = 0;
	for (let index = openBrace; index < text.length; index++) {
		if (!mask[index]) {
			continue;
		}
		if (text[index] === '{') {
			depth++;
		} else if (text[index] === '}') {
			depth--;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function findContainingClassBody(
	text: string,
	mask: Uint8Array,
	offset: number
): { start: number; end: number } | undefined {
	let best: { start: number; end: number } | undefined;

	for (let index = 0; index < offset; index++) {
		if (
			!hasIdentifierAt(text, mask, index, 'class') &&
			!hasIdentifierAt(text, mask, index, 'mixin')
		) {
			continue;
		}

		let openBrace = index;
		while (openBrace < text.length && (!mask[openBrace] || text[openBrace] !== '{')) {
			openBrace++;
		}
		if (openBrace >= text.length || openBrace > offset) {
			continue;
		}

		const closeBrace = findMatchingBrace(text, mask, openBrace);
		if (closeBrace < offset) {
			continue;
		}

		const candidate = { start: openBrace, end: closeBrace };
		if (!best || candidate.end - candidate.start < best.end - best.start) {
			best = candidate;
		}
	}

	return best;
}

function isDirectClassMember(
	text: string,
	mask: Uint8Array,
	classBodyStart: number,
	statementStart: number
): boolean {
	let depth = 0;
	for (let index = classBodyStart + 1; index < statementStart; index++) {
		if (!mask[index]) {
			continue;
		}
		if (text[index] === '{') {
			depth++;
		} else if (text[index] === '}') {
			depth--;
		}
	}
	return depth === 0;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPreviousNonEmptyLine(text: string, lineStart: number): string {
	let end = lineStart - 1;
	while (end >= 0) {
		const start = text.lastIndexOf('\n', end - 1) + 1;
		const line = text.slice(start, end + 1).trim();
		if (line) {
			return line;
		}
		end = start - 2;
	}
	return '';
}

function buildFieldWatchReplacement(options: {
	indent: string;
	isStatic: boolean;
	isLate: boolean;
	type: string;
	name: string;
	afterName: string;
	markerId: string;
	originalText: string;
}): {
	replacement: string;
	readBreakpointOffset: number;
	writeBreakpointOffset: number;
} {
	const {
		indent,
		isStatic,
		isLate,
		type,
		name,
		afterName,
		markerId,
		originalText
	} = options;
	const encodedOriginal = Buffer.from(originalText, 'utf8').toString('base64');
	const staticPrefix = isStatic ? 'static ' : '';
	const latePrefix = isLate ? 'late ' : '';
	const backingName = `_${name}`;
	const lines = [
		`${indent}// flutter-tools-watch:start:${markerId}:${name}:${encodedOriginal}`,
		`${indent}${staticPrefix}${latePrefix}${type} ${backingName}${afterName};`,
		`${indent}${staticPrefix}${type} get ${name} {`,
		`${indent}  return ${backingName};`,
		`${indent}}`,
		'',
		`${indent}${staticPrefix}set ${name}(${type} value) {`,
		`${indent}  ${backingName} = value;`,
		`${indent}}`,
		`${indent}// flutter-tools-watch:end:${markerId}`
	];
	const replacement = lines.join('\n');

	return {
		replacement,
		readBreakpointOffset: replacement.indexOf(`return ${backingName};`),
		writeBreakpointOffset: replacement.indexOf(`${backingName} = value;`)
	};
}

/**
 * Converts a simple explicitly typed class field into a reversible backing
 * field plus explicit getter/setter block.
 */
export function createFieldWatchInstrumentation(
	text: string,
	declarationOffset: number,
	markerId: string
): FieldWatchInstrumentation | undefined {
	const safeOffset = Math.max(0, Math.min(declarationOffset, text.length));
	const mask = createCodeMask(text);
	const lineStart = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
	const lineEndIndex = text.indexOf('\n', safeOffset);
	const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
	const line = text.slice(lineStart, lineEnd);
	const relativeOffset = safeOffset - lineStart;

	if (line.includes('flutter-tools-watch:')) {
		return undefined;
	}

	let nameStart = relativeOffset;
	while (nameStart > 0 && isIdentifierCharacter(line[nameStart - 1])) {
		nameStart--;
	}
	let nameEnd = relativeOffset;
	while (nameEnd < line.length && isIdentifierCharacter(line[nameEnd])) {
		nameEnd++;
	}
	const name = line.slice(nameStart, nameEnd);
	if (!name) {
		return undefined;
	}

	let semicolon = -1;
	for (let index = nameEnd; index < line.length; index++) {
		if (mask[lineStart + index] && line[index] === ';') {
			semicolon = index;
			break;
		}
	}
	if (semicolon < 0) {
		return undefined;
	}

	const beforeName = line.slice(0, nameStart);
	const afterName = line.slice(nameEnd, semicolon);
	if (!/^\s*(?:=.*)?$/s.test(afterName)) {
		return undefined;
	}

	const indent = beforeName.match(/^[ \t]*/)?.[0] ?? '';
	let declarationPrefix = beforeName.slice(indent.length).trim();
	let isStatic = false;
	let isLate = false;
	let removedModifier = true;
	while (removedModifier) {
		removedModifier = false;
		if (/^static\b/.test(declarationPrefix)) {
			isStatic = true;
			declarationPrefix = declarationPrefix.replace(/^static\b/, '').trimStart();
			removedModifier = true;
		}
		if (/^late\b/.test(declarationPrefix)) {
			isLate = true;
			declarationPrefix = declarationPrefix.replace(/^late\b/, '').trimStart();
			removedModifier = true;
		}
	}

	const type = declarationPrefix.trim();
	if (
		!type ||
		/\b(?:const|covariant|external|final|var)\b/.test(type) ||
		type.includes('@') ||
		type.includes('=')
	) {
		return undefined;
	}

	const classBody = findContainingClassBody(text, mask, lineStart);
	if (!classBody || !isDirectClassMember(text, mask, classBody.start, lineStart)) {
		return undefined;
	}

	const previousLine = getPreviousNonEmptyLine(text, lineStart);
	if (previousLine.startsWith('@') || previousLine.startsWith('///')) {
		return undefined;
	}

	const backingNamePattern = new RegExp(`\\b${escapeRegExp(`_${name}`)}\\b`);
	const classBodyText = text.slice(classBody.start + 1, classBody.end);
	if (backingNamePattern.test(classBodyText)) {
		return undefined;
	}
	// Initializing formals require a real field and cannot target an explicit
	// setter. Fall back to reference breakpoints for these declarations.
	const initializingFormalPattern = new RegExp(
		`\\bthis\\s*\\.\\s*${escapeRegExp(name)}\\b`
	);
	if (initializingFormalPattern.test(classBodyText)) {
		return undefined;
	}

	const originalText = line;
	const built = buildFieldWatchReplacement({
		indent,
		isStatic,
		isLate,
		type,
		name,
		afterName,
		markerId,
		originalText
	});

	return {
		start: lineStart,
		end: lineEnd,
		replacement: built.replacement,
		fieldName: name,
		markerId,
		readBreakpointOffset: built.readBreakpointOffset,
		writeBreakpointOffset: built.writeBreakpointOffset
	};
}

export function findExistingFieldWatch(text: string, offset: number): ExistingFieldWatch | undefined {
	const startPattern = /^([ \t]*)\/\/ flutter-tools-watch:start:([^:\n]+):([^:\n]+):([A-Za-z0-9+/=]+)$/gm;
	let match: RegExpExecArray | null;

	while ((match = startPattern.exec(text)) !== null) {
		const markerId = match[2];
		const fieldName = match[3];
		const encodedOriginal = match[4];
		const endPattern = new RegExp(
			`^[ \\t]*// flutter-tools-watch:end:${escapeRegExp(markerId)}$`,
			'gm'
		);
		endPattern.lastIndex = startPattern.lastIndex;
		const endMatch = endPattern.exec(text);
		if (!endMatch) {
			continue;
		}

		const start = match.index;
		const end = endMatch.index + endMatch[0].length;
		if (offset < start || offset > end) {
			continue;
		}

		let originalText: string;
		try {
			originalText = Buffer.from(encodedOriginal, 'base64').toString('utf8');
		} catch {
			return undefined;
		}

		const block = text.slice(start, end);
		const readText = `return _${fieldName};`;
		const writeText = `_${fieldName} = value;`;
		const readRelativeOffset = block.indexOf(readText);
		const writeRelativeOffset = block.indexOf(writeText);
		if (readRelativeOffset < 0 || writeRelativeOffset < 0) {
			return undefined;
		}

		return {
			start,
			end,
			originalText,
			fieldName,
			markerId,
			readBreakpointOffset: start + readRelativeOffset,
			writeBreakpointOffset: start + writeRelativeOffset
		};
	}

	return undefined;
}

function startsWithAssignmentOperator(text: string, mask: Uint8Array, index: number): string | undefined {
	for (const operator of ['>>>=', '>>=', '<<=', '??=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '=']) {
		if (!text.startsWith(operator, index)) {
			continue;
		}
		if (operator === '=' && (text[index + 1] === '=' || text[index + 1] === '>')) {
			continue;
		}
		if (
			Array.from({ length: operator.length }, (_, offset) => mask[index + offset]).every(Boolean)
		) {
			return operator;
		}
	}
	return undefined;
}

function parseRxValueWrite(
	text: string,
	mask: Uint8Array,
	referenceEnd: number
): boolean {
	let index = skipTriviaForward(text, mask, referenceEnd);
	if (text.startsWith('..', index) && mask[index] && mask[index + 1]) {
		index = skipTriviaForward(text, mask, index + 2);
	} else if (text[index] === '.' && mask[index]) {
		index = skipTriviaForward(text, mask, index + 1);
	} else {
		return false;
	}

	if (!hasIdentifierAt(text, mask, index, 'value')) {
		return false;
	}
	index = skipTriviaForward(text, mask, index + 'value'.length);
	return (
		!!startsWithAssignmentOperator(text, mask, index) ||
		(text.startsWith('++', index) && !!mask[index] && !!mask[index + 1]) ||
		(text.startsWith('--', index) && !!mask[index] && !!mask[index + 1])
	);
}

/**
 * Classifies a Dart identifier reference well enough for temporary source
 * breakpoints. Complex assignments are both reads and writes.
 */
export function classifyVariableReference(
	text: string,
	referenceStart: number,
	referenceEnd: number
): VariableReferenceKind {
	const mask = createCodeMask(text);
	const after = skipTriviaForward(text, mask, referenceEnd);
	const before = skipTriviaBackward(text, mask, referenceStart - 1);
	const assignmentOperator = startsWithAssignmentOperator(text, mask, after);
	const postfixWrite =
		(text.startsWith('++', after) && !!mask[after] && !!mask[after + 1]) ||
		(text.startsWith('--', after) && !!mask[after] && !!mask[after + 1]);
	const prefixWrite =
		(before >= 1 && text.slice(before - 1, before + 1) === '++' && !!mask[before - 1] && !!mask[before]) ||
		(before >= 1 && text.slice(before - 1, before + 1) === '--' && !!mask[before - 1] && !!mask[before]);
	const isWrite = !!assignmentOperator || postfixWrite || prefixWrite;
	const isSimpleAssignment = assignmentOperator === '=';

	return {
		read: !isSimpleAssignment,
		write: isWrite,
		rxValueWrite: parseRxValueWrite(text, mask, referenceEnd)
	};
}
