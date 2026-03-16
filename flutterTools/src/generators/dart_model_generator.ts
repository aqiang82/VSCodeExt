
type Json = any;

// 记录生成过的类，避免重复定义
const generatedClasses = new Map<string, string>();

// Dart 类型映射
function getDartType(key: string, value: any, parentClassName: string): string {
  if (value === null) return 'dynamic';

  if (Array.isArray(value)) {
    if (value.length > 0) {
      const firstType = getDartType(key, value[0], parentClassName);
      return `List<${firstType.replace('?', '')}>?`;
    } else {
      return 'List<dynamic>?';
    }
  }

  switch (typeof value) {
    case 'string': return 'String?';
    case 'number': return Number.isInteger(value) ? 'int?' : 'double?';
    case 'boolean': return 'bool?';
    case 'object': {
      const nestedClassName = capitalize(key) + 'Model';
      if (!generatedClasses.has(nestedClassName)) {
        generatedClasses.set(nestedClassName, generateClassCode(nestedClassName, value));
      }
      return `${nestedClassName}?`;
    }
    default:
      return 'dynamic?';
  }
}


function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function generateDartClass(className: string, jsonObj: Json): string {
  generatedClasses.clear();

  // 主类始终使用用户输入名（并加 Model 后缀）
  const mainClassName = className.endsWith('Model') ? className : className + 'Model';
  const mainClass = generateClassCode(mainClassName, jsonObj);

  let allNested = [...generatedClasses.values()].join('\n\n');

  return (mainClass + '\n\n' + allNested).trim();
}


function generateClassCode(className: string, jsonObj: Json): string {
  let fields = '';
  let constructorParams = '';
  let fromJsonBody = '';
  let toJsonBody = '    final Map<String, dynamic> data = <String, dynamic>{};\n';

  for (const [key, value] of Object.entries(jsonObj)) {
    const dartType = getDartType(key, value, className);
    fields += `  final ${dartType} ${key};\n`;
    constructorParams += `    this.${key},\n`;

    fromJsonBody += generateFromJsonLine(key, value, dartType);
    toJsonBody += generateToJsonLine(key, value, dartType);
  }

  toJsonBody += '    return data;\n';

  return `class ${className} {\n` +
         fields + '\n' +
         `  ${className}({\n${constructorParams}  });\n\n` +

         `  factory ${className}.fromJson(Map<String, dynamic> json) {\n` +
         `    return ${className}(\n${fromJsonBody}    );\n` +
         `  }\n\n` +

         `  Map<String, dynamic> toJson() {\n` +
         toJsonBody +
         `  }\n` +
         `}`;
}

// 生成 fromJson 代码行
function generateFromJsonLine(key: string, value: any, dartType: string): string {

  if (dartType.startsWith('List<')) {
    const itemType = dartType.match(/List<(\w+)>/)?.[1] || 'dynamic';
    if (itemType === 'dynamic') {
      return `      ${key}: json['${key}'],\n`;
    }
    if (isBasicType(itemType)) {
      return `      ${key}: (json['${key}'] as List<dynamic>?)?.map((e) => e as ${itemType}).toList(),\n`;
    }
    // 嵌套对象数组
    return `      ${key}: (json['${key}'] as List<dynamic>?)?.map((e) => ${itemType}.fromJson(e as Map<String, dynamic>)).toList(),\n`;
  }

  if (dartType === 'String?') {
    return `      ${key}: json['${key}']?.toString(),\n`;
  }
  if (dartType === 'int?') {
    return `      ${key}: int.tryParse(json['${key}']?.toString() ?? ''),\n`;
  }
  if (dartType === 'double?') {
    return `      ${key}: double.tryParse(json['${key}']?.toString() ?? ''),\n`;
  }
  if (dartType === 'bool?') {
    return `      ${key}: json['${key}'] == null ? null : json['${key}'] == true || json['${key}']?.toString() == 'true',\n`;
  }
  if (dartType === 'dynamic') {
    return `      ${key}: json['${key}'],\n`;
  }
  if (dartType.endsWith('?')) {
    // 嵌套对象
    const className = dartType.replace('?', '');
    return `      ${key}: json['${key}'] == null ? null : ${className}.fromJson(json['${key}'] as Map<String, dynamic>),\n`;
  }

  // fallback
  return `      ${key}: json['${key}']?.toString(),\n`;
}

// 生成 toJson 代码行
function generateToJsonLine(key: string, value: any, dartType: string): string {
  if (dartType.startsWith('List<')) {
    if (dartType.includes('dynamic')) {
      return `    data['${key}'] = ${key};\n`;
    }
    // 如果是对象列表，调用 toJson
    const itemType = dartType.match(/List<(\w+)>/)?.[1] || '';
    if (isBasicType(itemType)) {
      return `    data['${key}'] = ${key};\n`;
    }
    return `    data['${key}'] = ${key}?.map((e) => e.toJson()).toList();\n`;
  }

  if (isBasicType(dartType.replace('?', ''))) {
    return `    data['${key}'] = ${key};\n`;
  }

  // 嵌套对象调用 toJson
  return `    data['${key}'] = ${key}?.toJson();\n`;
}

// 判断是否是基本类型
function isBasicType(type: string): boolean {
  return ['String', 'int', 'double', 'bool', 'dynamic'].includes(type);
}
