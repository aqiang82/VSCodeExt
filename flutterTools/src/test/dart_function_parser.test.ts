import * as assert from 'assert';
import { findFunctionOffsets } from '../dart_function_parser';

suite('Dart function parser', () => {
	test('selects a complete function when its first statement is an if block', () => {
		const source = `void submit() {
  if (isInvalid) {
    return;
  }
  save();
}`;

		const offsets = findFunctionOffsets(source, source.indexOf('return'));
		assert.deepStrictEqual(offsets, { start: 0, end: source.length });
		assert.strictEqual(source.slice(offsets?.start, offsets?.end), source);
	});

	test('balances nested if/else blocks', () => {
		const source = `Future<void> load() async {
  if (ready) {
    if (cached) {
      useCache();
    } else {
      await fetch();
    }
  }
  finish();
}`;

		const offsets = findFunctionOffsets(source, source.indexOf('await fetch'));
		assert.deepStrictEqual(offsets, { start: 0, end: source.length });
	});

	test('ignores braces in strings and comments', () => {
		const source = `void render() {
  final text = "} not the function end";
  // }
  /* { nested comment } */
  if (visible) {
    print(r'{raw}');
  }
}`;

		const offsets = findFunctionOffsets(source, source.indexOf('print'));
		assert.deepStrictEqual(offsets, { start: 0, end: source.length });
	});

	test('supports named parameters and generic methods', () => {
		const source = `@override
T choose<T>({
  required T value,
  bool enabled = true,
}) {
  if (enabled) {
    return value;
  }
  throw StateError('disabled');
}`;

		const offsets = findFunctionOffsets(source, source.indexOf('return value'));
		assert.deepStrictEqual(offsets, { start: 0, end: source.length });
	});

	test('selects the smallest nested local function', () => {
		const source = `void outer() {
  void inner() {
    if (ok) {
      run();
    }
  }
  inner();
}`;
		const innerStart = source.indexOf('  void inner()');
		const innerEnd = source.indexOf('\n  }\n  inner()') + 4;

		const offsets = findFunctionOffsets(source, source.indexOf('run();'));
		assert.deepStrictEqual(offsets, { start: innerStart, end: innerEnd });
	});

	test('finds the real terminator of an arrow function', () => {
		const source = `Widget build() => Builder(
  builder: (_) {
    log('building');
    return child;
  },
);`;

		const offsets = findFunctionOffsets(source, source.indexOf('return child'));
		assert.deepStrictEqual(offsets, { start: 0, end: source.length });
	});
});
