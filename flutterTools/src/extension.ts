import * as vscode from 'vscode';
import { generateDartClass } from './generators/dart_model_generator';
import { callDeepSeek } from './deepseek/deepseek';
import * as fs from 'fs';
import * as path from 'path';
import { extractWidgetToFile } from './generators/extract_widget_to_file';

export function activate(context: vscode.ExtensionContext) {
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

	// deepSeek 命令，暂时没用
	// let askDeepSeek = vscode.commands.registerCommand('flutterTools.askDeepSeek', askDeepSeekFunction);
	// context.subscriptions.push(askDeepSeek);

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

// 生成 GetX 模块
async function generateGetXModule(uri?: vscode.Uri) {
	if (!uri) {
		vscode.window.showErrorMessage('请在目录上右键创建 GetX Module');
		return;
	}
	function toSnakeCase(str: string): string {
		return str
			.replace(/([A-Z])/g, "_$1") // 大写前加下划线
			.toLowerCase()
			.replace(/^_/, ""); // 如果开头有下划线，去掉
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
		vscode.window.showErrorMessage('Module name is required');
		return;
	}

	const generateBinding = await vscode.window.showQuickPick(['Yes', 'No'], {
		placeHolder: 'Generate Binding file?',
	});
	const generateState = await vscode.window.showQuickPick(['Yes', 'No'], {
		placeHolder: 'Generate State file?',
	});

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

	// 各文件内容模版
	const stateFile =  generateState === 'Yes' ? `import '${snakeName}_state.dart';` : '';
	const initState =  generateState === 'Yes' ? `final state = ${pascalName}State();` : '';
	const controllerContent = `import 'package:get/get.dart';
${stateFile}
class ${pascalName}Controller extends GetxController {
  //TODO: Implement Controller
  ${initState}
}
`;
	
	const getState = generateState === 'Yes' ? `${pascalName}State get state => controller.state;` : '';
	const initView = `const ${pascalName}View({super.key});`;
	const viewContent = `import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '${snakeName}_controller.dart';
${stateFile}

class ${pascalName}View extends GetView<${pascalName}Controller> {
	${initView}
   ${getState}
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${pascalName}'),
        centerTitle: true,
      ),
      body: Container(),
    );
  }
}
`;

	const bindingContent = `import 'package:get/get.dart';
import '${snakeName}_controller.dart';

class ${pascalName}Binding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<${pascalName}Controller>(() => ${pascalName}Controller());
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
	writeFile(`${snakeName}_controller.dart`, controllerContent);
	writeFile(`${snakeName}_view.dart`, viewContent);

	// 生成可选文件
	if (generateBinding === 'Yes') {
		writeFile(`${snakeName}_binding.dart`, bindingContent);
	}
	if (generateState === 'Yes') {
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

	const cursorOffset = document.offsetAt(position);

	// 向左找 widget 起始的括号
	let start = cursorOffset;
	while (start > 0 && text[start] !== '(') {
		start--;
	}

	// 向左找 widget 名字（包含 . 点）
	while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) {
		start--;
	}

	// 向右找 widget 结尾（括号平衡）
	let end = cursorOffset;
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