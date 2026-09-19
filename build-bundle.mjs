// ============================================================
// 可选的打包脚本（非构建工具，仅一次性拼接，非运行必需）
// 作用：把 src/ 下 6 个 ES 模块拼接为经典脚本 app.bundle.js，
//       使 index.html 在 file:// 协议下双击即可运行
//       （Chrome/Edge 禁止 file:// 加载 ES 模块，会报 CORS 错误）
// 用法：修改 src/ 后执行  node build-bundle.mjs
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';

// 依赖顺序：被依赖者在前
const ORDER = [
  'inline-parser',
  'block-parser',
  'renderer',
  'tests',
  'ui',
  'main',
];

const header = `/* ============================================================
   app.bundle.js —— 由 src/ 下 6 个 ES 模块拼接生成的经典脚本
   目的：让 index.html 在 file:// 协议下双击即可运行
   请勿直接编辑本文件；修改 src/ 后运行：node build-bundle.mjs
   ============================================================ */
`;

const parts = ORDER.map((name) => {
  const code = readFileSync('src/' + name + '.js', 'utf8')
    .replace(/^import[\s\S]*?from\s+'[^']*';\n/gm, '') // 去掉 import 语句
    .replace(/^export\s+/gm, ''); // 去掉 export 关键字
  return '\n/* ==================== src/' + name + '.js ==================== */\n' + code.trim() + '\n';
});

writeFileSync('app.bundle.js', header + parts.join('\n'), 'utf8');
console.log('app.bundle.js regenerated (' + ORDER.length + ' modules)');