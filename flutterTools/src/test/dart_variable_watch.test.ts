import * as assert from 'assert';
import {
	classifyVariableReference,
	createFieldWatchInstrumentation,
	findExistingFieldWatch
} from '../dart_variable_watch';

suite('Dart variable watch', () => {
	test('instruments and restores a simple class field losslessly', () => {
		const source = `class Controller {
  String name = ''; // initial value
}`;
		const offset = source.indexOf('name');
		const edit = createFieldWatchInstrumentation(source, offset, 'watch1');
		assert.ok(edit);

		const instrumented =
			source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
		assert.match(instrumented, /String _name = '';/);
		assert.match(instrumented, /String get name \{/);
		assert.match(instrumented, /set name\(String value\) \{/);

		const existing = findExistingFieldWatch(
			instrumented,
			instrumented.indexOf('get name')
		);
		assert.ok(existing);
		const restored =
			instrumented.slice(0, existing.start) +
			existing.originalText +
			instrumented.slice(existing.end);
		assert.strictEqual(restored, source);
	});

	test('preserves static and late modifiers', () => {
		const source = `class Cache {
  static late Map<String, int>? values;
}`;
		const edit = createFieldWatchInstrumentation(source, source.indexOf('values'), 'watch2');
		assert.ok(edit);
		assert.match(edit.replacement, /static late Map<String, int>\? _values;/);
		assert.match(edit.replacement, /static Map<String, int>\? get values/);
		assert.match(edit.replacement, /static set values\(Map<String, int>\? value\)/);
	});

	test('rejects locals, final fields, annotated fields and backing-name collisions', () => {
		const local = `void run() {
  String name = '';
}`;
		assert.strictEqual(
			createFieldWatchInstrumentation(local, local.indexOf('name'), 'local'),
			undefined
		);

		const finalField = `class C {
  final String name = '';
}`;
		assert.strictEqual(
			createFieldWatchInstrumentation(finalField, finalField.indexOf('name'), 'final'),
			undefined
		);

		const annotated = `class C {
  @JsonKey(name: 'name')
  String name = '';
}`;
		assert.strictEqual(
			createFieldWatchInstrumentation(annotated, annotated.lastIndexOf('name'), 'annotation'),
			undefined
		);

		const collision = `class C {
  String _name = '';
  String name = '';
}`;
		assert.strictEqual(
			createFieldWatchInstrumentation(collision, collision.lastIndexOf('name'), 'collision'),
			undefined
		);

		const initializingFormal = `class C {
  String name;
  C(this.name);
}`;
		assert.strictEqual(
			createFieldWatchInstrumentation(
				initializingFormal,
				initializingFormal.indexOf('name'),
				'formal'
			),
			undefined
		);
	});

	test('classifies ordinary reads and writes', () => {
		const assignment = `controller.name = nextName;`;
		const assignmentStart = assignment.indexOf('name');
		assert.deepStrictEqual(
			classifyVariableReference(assignment, assignmentStart, assignmentStart + 4),
			{ read: false, write: true, rxValueWrite: false }
		);

		const compound = `controller.count += delta;`;
		const compoundStart = compound.indexOf('count');
		assert.deepStrictEqual(
			classifyVariableReference(compound, compoundStart, compoundStart + 5),
			{ read: true, write: true, rxValueWrite: false }
		);

		const read = `Text(controller.name)`;
		const readStart = read.indexOf('name');
		assert.deepStrictEqual(
			classifyVariableReference(read, readStart, readStart + 4),
			{ read: true, write: false, rxValueWrite: false }
		);
	});

	test('recognizes GetX Rx value assignments', () => {
		for (const source of [
			`count.value = 1;`,
			`controller.count.value += 1;`,
			`count.value++;`,
			`count..value = 2;`
		]) {
			const start = source.indexOf('count');
			assert.strictEqual(
				classifyVariableReference(source, start, start + 'count'.length).rxValueWrite,
				true,
				source
			);
		}

		const read = `Text('${'${count.value}'}')`;
		const start = read.indexOf('count');
		assert.strictEqual(
			classifyVariableReference(read, start, start + 'count'.length).rxValueWrite,
			false
		);
	});
});
