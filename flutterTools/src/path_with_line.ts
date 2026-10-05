export type LineSelection = {
	/** 0-based line of the selection start. */
	startLine: number;
	/** 0-based line of the selection end. */
	endLine: number;
	/** 0-based character of the selection end. */
	endCharacter: number;
};

/**
 * Formats a selection as a 1-based line reference: `155` or `100-120`.
 *
 * A multi-line selection that ends at column 0 (for example after selecting
 * whole lines with Shift+Down) does not include that last line.
 */
export function formatLineRange(selection: LineSelection): string {
	const startLine = Math.min(selection.startLine, selection.endLine);
	let endLine = Math.max(selection.startLine, selection.endLine);
	if (endLine > startLine && selection.endCharacter === 0 && selection.endLine === endLine) {
		endLine--;
	}

	return startLine === endLine
		? `${startLine + 1}`
		: `${startLine + 1}-${endLine + 1}`;
}

/**
 * Builds `path:line` or `path:start-end` for each selection, one per line.
 * Duplicate references from multiple cursors on the same line are dropped.
 */
export function formatPathWithLines(relativePath: string, selections: readonly LineSelection[]): string {
	const sorted = [...selections].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
	const references = sorted.map(selection => `${relativePath}:${formatLineRange(selection)}`);
	return [...new Set(references)].join('\n');
}
