import * as assert from 'assert';
import { findWidgetUnwrapEdit } from '../dart_widget_unwrapper';

function unwrap(source: string, cursorText: string, wrapper: 'Obx' | 'GetBuilder'): string | undefined {
	const cursor = source.indexOf(cursorText);
	const edit = findWidgetUnwrapEdit(source, cursor, cursor, wrapper);
	if (!edit) {
		return undefined;
	}
	return source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
}

suite('Dart widget unwrapper', () => {
	test('removes an arrow-style Obx from a cursor inside its child', () => {
		const source = `return Obx(() => Text(controller.name.value));`;
		assert.strictEqual(
			unwrap(source, 'controller.name', 'Obx'),
			`return Text(controller.name.value);`
		);
	});

	test('removes a block-style Obx', () => {
		const source = `child: Obx(() {
  return const SizedBox(
    width: 20,
  );
}),`;
		assert.strictEqual(
			unwrap(source, 'width', 'Obx'),
			`child: const SizedBox(
  width: 20,
),`
		);
	});

	test('removes a multiline formatted Obx and dedents its child', () => {
		const source = `return Obx(
  () => Column(
    children: const [],
  ),
);`;
		assert.strictEqual(
			unwrap(source, 'children', 'Obx'),
			`return Column(
  children: const [],
);`
		);
	});

	test('removes GetBuilder while preserving the outer trailing comma', () => {
		const source = `child: GetBuilder<HomeController>(
  init: HomeController(),
  builder: (controller) {
    return Text(controller.title);
  },
),`;
		assert.strictEqual(
			unwrap(source, 'controller.title', 'GetBuilder'),
			`child: Text(controller.title),`
		);
	});

	test('supports an arrow-style GetBuilder builder', () => {
		const source = `return GetBuilder<CounterController>(
  builder: (controller) => Text('${'${controller.count}'}'),
);`;
		assert.strictEqual(
			unwrap(source, 'controller.count', 'GetBuilder'),
			`return Text('${'${controller.count}'}');`
		);
	});

	test('chooses the nearest nested matching parent', () => {
		const source = `Obx(() => Column(children: [
  Obx(() => Text(controller.name.value)),
]));`;
		assert.strictEqual(
			unwrap(source, 'controller.name', 'Obx'),
			`Obx(() => Column(children: [
  Text(controller.name.value),
]));`
		);
	});

	test('does not remove a block wrapper that would discard statements', () => {
		const source = `Obx(() {
  final name = controller.name.value;
  return Text(name);
})`;
		assert.strictEqual(unwrap(source, 'Text(name)', 'Obx'), undefined);
	});

	test('ignores wrapper-like text inside strings and comments', () => {
		const source = `// Obx(() => Text('comment'))
final source = "GetBuilder(builder: (_) => Text('string'))";`;
		assert.strictEqual(unwrap(source, 'Text', 'Obx'), undefined);
		assert.strictEqual(unwrap(source, 'Text', 'GetBuilder'), undefined);
	});
});
