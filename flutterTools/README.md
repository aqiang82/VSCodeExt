# 命令:
flutterTools.extractWidgetToFile
根据选中的文本，在同层目录生成widget文件

flutterTools.generateModelFromJson
选中json字符串，在当前文件生成带fromJson和toJson的Model类

flutterTools.selectCurrentWidget
根据当前的光标，选中当前的widget

flutterTools.removeObxParent
移除光标所在 Widget 最近一层的 Obx 包装

flutterTools.removeGetBuilderParent
移除光标所在 Widget 最近一层的 GetBuilder 包装

flutterTools.watchVariableAccess
监视普通变量的读取或写入；简单类字段会临时生成 getter/setter 并自动添加断点

flutterTools.breakOnRxValueWrites
查找当前 GetX Rx 变量的所有 `.value` 写入位置并添加断点

flutterTools.removeVariableWatch
恢复被临时转换的字段并移除对应断点

flutterTools.clearVariableWatchBreakpoints
清除本插件添加的变量监视断点

flutterTools.generateConstructorParams
根据当前的光标，生成当前类的构造函数和参数。

flutterTools.generateGetXModule
生成一套基本的公用的getX模版,支持驼峰命名和下划线命名(目录哪里右键会出现)

#开发说明
记住运行之前先用命令编译才会生效：
npm run compile

#其他说明
安装打包工具：
npm install -g vsce

#本地安装
打包插件:
vsce package

#发布插件
发布插件（可选）
在 Visual Studio Marketplace 创建发布者

登录并获取 Personal Access Token

发布：
vsce login your-publisher-name
vsce publish
