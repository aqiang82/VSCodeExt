import * as assert from 'assert';
import { formatLineRange, formatPathWithLines } from '../path_with_line';

suite('Path with line', () => {
	test('uses the cursor line when nothing is selected', () => {
		assert.strictEqual(
			formatPathWithLines('lib/main.dart', [{ startLine: 154, endLine: 154, endCharacter: 8 }]),
			'lib/main.dart:155'
		);
	});

	test('formats a multi-line selection as a range', () => {
		assert.strictEqual(
			formatPathWithLines('lib/main.dart', [{ startLine: 99, endLine: 119, endCharacter: 3 }]),
			'lib/main.dart:100-120'
		);
	});

	test('excludes the last line when the selection ends at column 0', () => {
		assert.strictEqual(formatLineRange({ startLine: 99, endLine: 120, endCharacter: 0 }), '100-120');
		assert.strictEqual(formatLineRange({ startLine: 99, endLine: 100, endCharacter: 0 }), '100');
	});

	test('lists multiple cursors in order without duplicates', () => {
		assert.strictEqual(
			formatPathWithLines('lib/a.dart', [
				{ startLine: 19, endLine: 24, endCharacter: 2 },
				{ startLine: 9, endLine: 9, endCharacter: 4 },
				{ startLine: 9, endLine: 9, endCharacter: 6 }
			]),
			'lib/a.dart:10\nlib/a.dart:20-25'
		);
	});
});
