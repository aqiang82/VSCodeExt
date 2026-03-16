import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function extractWidgetToFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (selectedText.trim() === '') {
    vscode.window.showErrorMessage('请先选择要提取的组件');
    return;
  }

  const widgetName = await vscode.window.showInputBox({
    prompt: '请输入组件名（如 LoginButton), 一定要驼峰命名哦!',
    validateInput: (value) => /^[A-Z][A-Za-z0-9]*$/.test(value) ? null : '请输入合法的 Dart 类名（驼峰命名）',
  });

  if (!widgetName) return;

  const fileName = widgetName
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase() + '.dart';

  const currentFile = editor.document.uri;
  const folderPath = path.dirname(currentFile.fsPath);
  const newFilePath = path.join(folderPath, fileName);

  if (fs.existsSync(newFilePath)) {
    vscode.window.showErrorMessage(`文件 ${fileName} 已存在`);
    return;
  }

  const widgetCode = `import 'package:flutter/material.dart';

class ${widgetName} extends StatelessWidget {
  const ${widgetName}({super.key});

  @override
  Widget build(BuildContext context) {
    return ${selectedText.trim()};
  }
}
`;

  fs.writeFileSync(newFilePath, widgetCode, 'utf8');

  // 插入 import
  const relativeImport = `import '${fileName}';\n`;
  const insertPosition = new vscode.Position(0, 0);
  editor.edit(editBuilder => {
    editBuilder.insert(insertPosition, relativeImport);
    editBuilder.replace(selection, `${widgetName}()`);
  });

  vscode.window.showInformationMessage(`组件已提取到 ${fileName}`);
}
