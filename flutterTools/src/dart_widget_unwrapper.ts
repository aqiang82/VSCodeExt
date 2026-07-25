export type RemovableWidgetWrapper = 'Obx' | 'GetBuilder';

export type WidgetUnwrapEdit = {
	start: number;
	end: number;
	replacement: string;
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

function findMatchingAngleBracket(text: string, mask: Uint8Array, openIndex: number): number {
	return findMatchingForward(text, mask, openIndex, '<', '>');
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

function trimTopLevelTrailingComma(
	text: string,
	mask: Uint8Array,
	start: number,
	end: number
): number {
	const lastCodeCharacter = skipTriviaBackward(text, mask, end - 1);
	if (lastCodeCharacter >= start && text[lastCodeCharacter] === ',') {
		return lastCodeCharacter;
	}
	return end;
}

function getLineIndentLength(text: string, offset: number): number {
	const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
	const linePrefix = text.slice(lineStart, offset);
	return linePrefix.match(/^[ \t]*/)?.[0].length ?? 0;
}

function normalizeExtractedExpression(
	text: string,
	expressionStart: number,
	expressionEnd: number,
	wrapperStart: number
): string {
	const rawExpression = text.slice(expressionStart, expressionEnd);
	const leadingWhitespaceLength = rawExpression.match(/^\s*/)?.[0].length ?? 0;
	const firstContentOffset = expressionStart + leadingWhitespaceLength;
	const expressionIndent = getLineIndentLength(text, firstContentOffset);
	const wrapperIndent = getLineIndentLength(text, wrapperStart);
	const indentToRemove = Math.max(0, expressionIndent - wrapperIndent);
	const trimmed = rawExpression.trim();

	if (!trimmed || indentToRemove === 0) {
		return trimmed;
	}

	return trimmed
		.split('\n')
		.map((line, index) => {
			if (index === 0 || line.trim() === '') {
				return line;
			}
			let removeCount = 0;
			while (removeCount < indentToRemove && /[ \t]/.test(line[removeCount] ?? '')) {
				removeCount++;
			}
			return line.slice(removeCount);
		})
		.join('\n');
}

function extractArrowExpression(
	text: string,
	mask: Uint8Array,
	arrowStart: number,
	expressionEnd: number,
	wrapperStart: number
): string | undefined {
	const end = trimTopLevelTrailingComma(text, mask, arrowStart + 2, expressionEnd);
	const expression = normalizeExtractedExpression(text, arrowStart + 2, end, wrapperStart);
	return expression || undefined;
}

function extractSingleReturnExpression(
	text: string,
	mask: Uint8Array,
	blockStart: number,
	blockEnd: number,
	wrapperStart: number
): string | undefined {
	let index = skipTriviaForward(text, mask, blockStart + 1);
	if (!hasIdentifierAt(text, mask, index, 'return')) {
		return undefined;
	}

	const expressionStart = index + 'return'.length;
	let parentheses = 0;
	let brackets = 0;
	let braces = 0;
	let semicolon = -1;

	for (index = expressionStart; index < blockEnd; index++) {
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
					semicolon = index;
				}
				break;
		}
		if (semicolon >= 0) {
			break;
		}
	}

	if (semicolon < 0 || skipTriviaForward(text, mask, semicolon + 1) !== blockEnd) {
		return undefined;
	}

	const expression = normalizeExtractedExpression(
		text,
		expressionStart,
		semicolon,
		wrapperStart
	);
	return expression || undefined;
}

function extractClosureExpression(
	text: string,
	mask: Uint8Array,
	closureStart: number,
	closureEnd: number,
	wrapperStart: number
): string | undefined {
	const parametersStart = skipTriviaForward(text, mask, closureStart);
	if (text[parametersStart] !== '(' || !mask[parametersStart]) {
		return undefined;
	}

	const parametersEnd = findMatchingForward(text, mask, parametersStart, '(', ')');
	if (parametersEnd < 0 || parametersEnd >= closureEnd) {
		return undefined;
	}

	const bodyStart = skipTriviaForward(text, mask, parametersEnd + 1);
	if (text.startsWith('=>', bodyStart) && mask[bodyStart] && mask[bodyStart + 1]) {
		return extractArrowExpression(text, mask, bodyStart, closureEnd, wrapperStart);
	}

	if (text[bodyStart] === '{' && mask[bodyStart]) {
		const bodyEnd = findMatchingForward(text, mask, bodyStart, '{', '}');
		if (bodyEnd < 0 || skipTriviaForward(text, mask, bodyEnd + 1) !== closureEnd) {
			return undefined;
		}
		return extractSingleReturnExpression(text, mask, bodyStart, bodyEnd, wrapperStart);
	}

	return undefined;
}

function findTopLevelBuilderValueStart(
	text: string,
	mask: Uint8Array,
	argumentsStart: number,
	argumentsEnd: number
): number {
	let parentheses = 0;
	let brackets = 0;
	let braces = 0;
	let angles = 0;

	for (let index = argumentsStart; index < argumentsEnd; index++) {
		if (!mask[index]) {
			continue;
		}

		if (
			parentheses === 0 &&
			brackets === 0 &&
			braces === 0 &&
			angles === 0 &&
			hasIdentifierAt(text, mask, index, 'builder')
		) {
			const colon = skipTriviaForward(text, mask, index + 'builder'.length);
			if (text[colon] === ':' && mask[colon]) {
				return skipTriviaForward(text, mask, colon + 1);
			}
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
			case '<':
				angles++;
				break;
			case '>':
				angles = Math.max(0, angles - 1);
				break;
		}
	}

	return -1;
}

function findBuilderArgumentEnd(
	text: string,
	mask: Uint8Array,
	valueStart: number,
	argumentsEnd: number
): number {
	let parentheses = 0;
	let brackets = 0;
	let braces = 0;

	for (let index = valueStart; index < argumentsEnd; index++) {
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
			case ',':
				if (parentheses === 0 && brackets === 0 && braces === 0) {
					return index;
				}
				break;
		}
	}

	return argumentsEnd;
}

function extractWrapperChild(
	text: string,
	mask: Uint8Array,
	wrapper: RemovableWidgetWrapper,
	wrapperStart: number,
	openParenthesis: number,
	closeParenthesis: number
): string | undefined {
	if (wrapper === 'Obx') {
		const closureEnd = trimTopLevelTrailingComma(
			text,
			mask,
			openParenthesis + 1,
			closeParenthesis
		);
		return extractClosureExpression(
			text,
			mask,
			openParenthesis + 1,
			closureEnd,
			wrapperStart
		);
	}

	const builderStart = findTopLevelBuilderValueStart(
		text,
		mask,
		openParenthesis + 1,
		closeParenthesis
	);
	if (builderStart < 0) {
		return undefined;
	}
	const builderEnd = findBuilderArgumentEnd(text, mask, builderStart, closeParenthesis);
	return extractClosureExpression(text, mask, builderStart, builderEnd, wrapperStart);
}

/**
 * Finds the smallest matching Obx/GetBuilder call that contains the current
 * cursor or selection and returns the edit needed to replace it with its child.
 */
export function findWidgetUnwrapEdit(
	text: string,
	selectionStart: number,
	selectionEnd: number,
	wrapper: RemovableWidgetWrapper
): WidgetUnwrapEdit | undefined {
	const safeStart = Math.max(0, Math.min(selectionStart, text.length));
	const safeEnd = Math.max(safeStart, Math.min(selectionEnd, text.length));
	const mask = createCodeMask(text);
	let best: WidgetUnwrapEdit | undefined;

	for (let nameStart = 0; nameStart < text.length; nameStart++) {
		if (!hasIdentifierAt(text, mask, nameStart, wrapper)) {
			continue;
		}

		let openParenthesis = skipTriviaForward(text, mask, nameStart + wrapper.length);
		if (text[openParenthesis] === '<' && mask[openParenthesis]) {
			const genericEnd = findMatchingAngleBracket(text, mask, openParenthesis);
			if (genericEnd < 0) {
				continue;
			}
			openParenthesis = skipTriviaForward(text, mask, genericEnd + 1);
		}
		if (text[openParenthesis] !== '(' || !mask[openParenthesis]) {
			continue;
		}

		const closeParenthesis = findMatchingForward(text, mask, openParenthesis, '(', ')');
		if (closeParenthesis < 0) {
			continue;
		}

		const containmentEnd =
			skipTriviaForward(text, mask, closeParenthesis + 1) < text.length &&
			text[skipTriviaForward(text, mask, closeParenthesis + 1)] === ','
				? skipTriviaForward(text, mask, closeParenthesis + 1) + 1
				: closeParenthesis + 1;
		if (safeStart < nameStart || safeEnd > containmentEnd) {
			continue;
		}

		const replacement = extractWrapperChild(
			text,
			mask,
			wrapper,
			nameStart,
			openParenthesis,
			closeParenthesis
		);
		if (!replacement) {
			continue;
		}

		const candidate = {
			start: nameStart,
			end: closeParenthesis + 1,
			replacement
		};
		if (!best || candidate.end - candidate.start < best.end - best.start) {
			best = candidate;
		}
	}

	return best;
}
