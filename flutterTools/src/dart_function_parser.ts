export type FunctionOffsets = {
	start: number;
	end: number;
};

const excludedNames = new Set([
	'assert',
	'catch',
	'do',
	'for',
	'if',
	'switch',
	'while',
	'with'
]);

function isIdentifierCharacter(value: string): boolean {
	return /[A-Za-z0-9_$]/.test(value);
}

/**
 * Marks Dart source characters that are code rather than comments or strings.
 *
 * Keeping source offsets unchanged lets the delimiter scanner ignore braces in
 * comments, ordinary strings, raw strings and triple-quoted strings.
 */
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
			const hasRawPrefix =
				rawPrefixIndex >= 0 &&
				(text[rawPrefixIndex] === 'r' || text[rawPrefixIndex] === 'R') &&
				(rawPrefixIndex === 0 || !isIdentifierCharacter(text[rawPrefixIndex - 1]));
			if (hasRawPrefix) {
				mask[rawPrefixIndex] = 0;
			}

			const delimiterLength = text.startsWith(quote.repeat(3), index) ? 3 : 1;
			index += delimiterLength;
			while (index < text.length) {
				if (text.startsWith(quote.repeat(delimiterLength), index)) {
					index += delimiterLength;
					break;
				}
				if (!hasRawPrefix && text[index] === '\\') {
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

function findMatchingForward(
	text: string,
	mask: Uint8Array,
	openIndex: number,
	openCharacter: string,
	closeCharacter: string
): number {
	let depth = 0;
	for (let index = openIndex; index < text.length; index++) {
		if (!mask[index]) {
			continue;
		}
		if (text[index] === openCharacter) {
			depth++;
		} else if (text[index] === closeCharacter) {
			depth--;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function findMatchingAngleBracketBackward(text: string, mask: Uint8Array, closeIndex: number): number {
	let depth = 0;
	for (let index = closeIndex; index >= 0; index--) {
		if (!mask[index]) {
			continue;
		}
		if (text[index] === '>') {
			depth++;
		} else if (text[index] === '<') {
			depth--;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function consumeAsyncModifier(text: string, mask: Uint8Array, start: number): number {
	let index = start;
	for (const keyword of ['async', 'sync']) {
		if (
			text.startsWith(keyword, index) &&
			Array.from({ length: keyword.length }, (_, offset) => mask[index + offset]).every(Boolean) &&
			!isIdentifierCharacter(text[index + keyword.length] ?? '')
		) {
			index = skipTriviaForward(text, mask, index + keyword.length);
			if (text[index] === '*' && mask[index]) {
				index = skipTriviaForward(text, mask, index + 1);
			}
			return index;
		}
	}
	return index;
}

function findArrowEnd(text: string, mask: Uint8Array, start: number): number {
	let parentheses = 0;
	let brackets = 0;
	let braces = 0;

	for (let index = start; index < text.length; index++) {
		if (!mask[index]) {
			continue;
		}
		switch (text[index]) {
			case '(':
				parentheses++;
				break;
			case ')':
				parentheses--;
				break;
			case '[':
				brackets++;
				break;
			case ']':
				brackets--;
				break;
			case '{':
				braces++;
				break;
			case '}':
				braces--;
				break;
			case ';':
				if (parentheses === 0 && brackets === 0 && braces === 0) {
					return index + 1;
				}
				break;
		}
	}

	return -1;
}

function findDeclarationStart(text: string, nameStart: number): number {
	let start = text.lastIndexOf('\n', nameStart - 1) + 1;

	// Include immediately preceding Dart annotations, matching the old command's
	// selection behavior without pulling in blank lines or documentation comments.
	while (start > 0) {
		const previousLineEnd = start - 1;
		const previousLineStart = text.lastIndexOf('\n', previousLineEnd - 1) + 1;
		const previousLine = text.slice(previousLineStart, previousLineEnd).trim();
		if (!previousLine.startsWith('@')) {
			break;
		}
		start = previousLineStart;
	}

	return start;
}

/**
 * Finds the smallest Dart function or method containing the cursor.
 *
 * Function parameters and bodies are scanned with balanced delimiters instead
 * of a greedy regular expression. This prevents a first-statement `if` block
 * from being mistaken for the function body.
 */
export function findFunctionOffsets(text: string, cursorOffset: number): FunctionOffsets | undefined {
	const safeOffset = Math.max(0, Math.min(cursorOffset, text.length));
	const mask = createCodeMask(text);
	let best: FunctionOffsets | undefined;

	for (let openParenthesis = 0; openParenthesis < text.length; openParenthesis++) {
		if (!mask[openParenthesis] || text[openParenthesis] !== '(') {
			continue;
		}

		let nameEnd = skipTriviaBackward(text, mask, openParenthesis - 1);
		if (text[nameEnd] === '>') {
			const genericStart = findMatchingAngleBracketBackward(text, mask, nameEnd);
			if (genericStart < 0) {
				continue;
			}
			nameEnd = skipTriviaBackward(text, mask, genericStart - 1);
		}

		const nameEndExclusive = nameEnd + 1;
		while (nameEnd >= 0 && mask[nameEnd] && isIdentifierCharacter(text[nameEnd])) {
			nameEnd--;
		}
		const nameStart = nameEnd + 1;
		const name = text.slice(nameStart, nameEndExclusive);
		if (!name || excludedNames.has(name)) {
			continue;
		}

		const closeParenthesis = findMatchingForward(text, mask, openParenthesis, '(', ')');
		if (closeParenthesis < 0) {
			continue;
		}

		let bodyStart = skipTriviaForward(text, mask, closeParenthesis + 1);
		bodyStart = consumeAsyncModifier(text, mask, bodyStart);

		let end = -1;
		if (
			text[bodyStart] === '=' &&
			text[bodyStart + 1] === '>' &&
			mask[bodyStart] &&
			mask[bodyStart + 1]
		) {
			end = findArrowEnd(text, mask, bodyStart + 2);
		} else if (text[bodyStart] === '{' && mask[bodyStart]) {
			const closeBrace = findMatchingForward(text, mask, bodyStart, '{', '}');
			if (closeBrace >= 0) {
				end = closeBrace + 1;
			}
		}

		if (end < 0) {
			continue;
		}

		const start = findDeclarationStart(text, nameStart);
		if (safeOffset < start || safeOffset > end) {
			continue;
		}

		if (!best || end - start < best.end - best.start) {
			best = { start, end };
		}
	}

	return best;
}
