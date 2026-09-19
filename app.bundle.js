/* ============================================================
   app.bundle.js —— 由 src/ 下 6 个 ES 模块拼接生成的经典脚本
   目的：让 index.html 在 file:// 协议下双击即可运行
   请勿直接编辑本文件；修改 src/ 后运行：node build-bundle.mjs
   ============================================================ */

/* ==================== src/inline-parser.js ==================== */
// ============================================================
// 行内解析器：把段落/标题/表格单元格内的文本解析为 HTML
// 处理顺序（优先级从高到低）：
//   1. 反斜杠转义   2. 行内代码   3. 图片/链接   4. 强调   5. 硬换行
// 已处理的内容替换为占位符 \u0000n\u0000，避免被后续规则二次解析
// ============================================================

// 可被反斜杠转义的字符
const ESCAPABLE = '\\`*_{}[]()#+-.!~>|';
// 占位符：\u0000 + 序号 + \u0000
const RE_PLACEHOLDER = /\u0000(\d+)\u0000/g;

/** HTML 特殊字符转义（含双引号，可直接用于属性值） */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** URL 安全校验：过滤 javascript: / vbscript: 等危险协议（忽略大小写与空白控制字符） */
function isSafeUrl(url) {
  const norm = url.replace(/[\s\u0000-\u001F]+/g, '').toLowerCase();
  return !norm.startsWith('javascript:') && !norm.startsWith('vbscript:');
}

/** 第一步：提取反斜杠转义，转义字符按普通文本输出 */
function extractEscapes(text, put) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length && ESCAPABLE.indexOf(text[i + 1]) !== -1) {
      out += put(escapeHtml(text[i + 1]));
      i++;
    } else {
      out += text[i];
    }
  }
  return out;
}

/** 第二步：提取行内代码 `...`，内容原样转义，不再解析任何语法 */
function extractCodeSpans(text, put) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        out += put('<code>' + escapeHtml(text.slice(i + 1, end)) + '</code>');
        i = end + 1;
        continue;
      }
      // 未闭合的反引号：按普通字符输出
    }
    out += text[i];
    i++;
  }
  return out;
}

/** 第三步：提取图片 ![alt](url) 与链接 [text](url) */
function extractLinksAndImages(text, put) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const isImage = text[i] === '!' && text[i + 1] === '[';
    const isLink = text[i] === '[';
    if (isImage || isLink) {
      const labelStart = i + (isImage ? 2 : 1);
      const closeB = text.indexOf(']', labelStart);
      if (closeB !== -1 && text[closeB + 1] === '(') {
        const closeP = text.indexOf(')', closeB + 2);
        if (closeP !== -1) {
          const label = text.slice(labelStart, closeB);
          const url = text.slice(closeB + 2, closeP).trim();
          if (isSafeUrl(url)) {
            if (isImage) {
              // alt 中去掉占位符标记，避免污染属性值
              const alt = escapeHtml(label.replace(RE_PLACEHOLDER, ''));
              out += put('<img src="' + escapeHtml(url) + '" alt="' + alt + '">');
            } else {
              // 链接文本允许强调等行内语法（转义与代码已在前面步骤处理过）
              out += put('<a href="' + escapeHtml(url) + '">' + parseEmphasis(escapeHtml(label), put) + '</a>');
            }
          } else {
            // 危险协议（如 javascript:）：整段按普通文本原样输出
            out += put(escapeHtml(text.slice(i, closeP + 1)));
          }
          i = closeP + 1;
          continue;
        }
      }
      // 未闭合的 [ 或 ![ ：按普通字符输出
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * 第四步：强调解析
 * 按 *** -> ** -> ~~ -> * 的顺序扫描配对定界符，
 * 配对内容包装后放入暂存区（占位符），避免被最终的整体转义破坏
 */
function parseEmphasis(text, put) {
  text = applyDelimiter(text, '***', put, (inner) => '<strong><em>' + inner + '</em></strong>');
  text = applyDelimiter(text, '**', put, (inner) => '<strong>' + inner + '</strong>');
  text = applyDelimiter(text, '~~', put, (inner) => '<del>' + inner + '</del>');
  text = applyDelimiter(text, '*', put, (inner) => '<em>' + inner + '</em>');
  return text;
}

/** 扫描一对 delim，把中间的非空内容用 wrap 包裹；找不到配对则原样输出 */
function applyDelimiter(text, delim, put, wrap) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(delim, i)) {
      const end = text.indexOf(delim, i + delim.length);
      if (end > i + delim.length) {
        out += put(wrap(text.slice(i + delim.length, end)));
        i = end + delim.length;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

/** 递归还原占位符（占位符内容里可能还嵌着更早生成的占位符） */
function resolveAll(text, stash) {
  return text.replace(RE_PLACEHOLDER, (_, n) => resolveAll(stash[Number(n)], stash));
}

/**
 * 对外入口：行内文本 -> HTML 字符串
 */
function parseInline(text) {
  const stash = [];
  // 把一段已完成的 HTML 放入暂存区，返回占位符
  const put = (html) => {
    stash.push(html);
    return '\u0000' + (stash.length - 1) + '\u0000';
  };

  let out = String(text == null ? '' : text);
  out = extractEscapes(out, put);
  out = extractCodeSpans(out, put);
  out = extractLinksAndImages(out, put);
  out = parseEmphasis(out, put);
  // 行尾两个及以上空格 -> 强制换行
  out = out.replace(/ {2,}\n/g, () => put('<br>'));
  // 段内普通换行按空格处理
  out = out.replace(/\n/g, ' ');

  // 转义剩余普通文本（占位符不含 & < > "，不受影响），再递归还原占位符
  return resolveAll(escapeHtml(out), stash);
}


/* ==================== src/block-parser.js ==================== */
// ============================================================
// 块级解析器：把 Markdown 源文本切分为块级 AST
// 支持：标题 / 段落 / 围栏代码块 / 引用块(可嵌套) / 列表(可嵌套、多段落) / 表格 / 水平线
// 行内语法（强调、链接、行内代码等）不在此处理，统一交给 inline-parser.js
// ============================================================

// 标题：1~6 个 # 后必须跟空白
const RE_HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
// 围栏代码块：``` 或 ```lang
const RE_FENCE_OPEN = /^```([A-Za-z0-9]*)[ \t]*$/;
const RE_FENCE_CLOSE = /^```[ \t]*$/;
// 水平线：三个及以上 * - _（允许中间夹空格）
const RE_HR = /^[ \t]{0,3}((\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
// 引用行：> 后可跟一个空白
const RE_QUOTE = /^[ \t]{0,3}>[ \t]?(.*)$/;
// 无序列表项：- * + 后必须跟空白
const RE_ULIST = /^([ ]*)([-*+])[ \t]+(.*)$/;
// 有序列表项：数字 + . 或 ) 后必须跟空白
const RE_OLIST = /^([ ]*)(\d{1,9})[.)][ \t]+(.*)$/;
// 表格分隔行单元格：--- :--- ---: :---:
const RE_TABLE_SEP_CELL = /^:?-{1,}:?$/;

/** 计算行首空格数 */
function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

/** 去掉行首最多 n 个空格 */
function stripIndent(line, n) {
  let k = 0;
  while (k < line.length && k < n && line[k] === ' ') k++;
  return line.slice(k);
}

/**
 * 匹配列表项，返回 { indent, ordered, markerWidth, content } 或 null
 * markerWidth = 标记宽度 + 1 个空格，用于计算续行对齐缩进
 */
function matchListItem(line) {
  let m = RE_ULIST.exec(line);
  if (m) {
    return { indent: m[1].length, ordered: false, markerWidth: 2, content: m[3] };
  }
  m = RE_OLIST.exec(line);
  if (m) {
    return { indent: m[1].length, ordered: true, markerWidth: m[2].length + 2, content: m[3] };
  }
  return null;
}

/**
 * 切分表格行：去掉首尾 |，按未转义的 | 切分（\| 保留给行内解析器处理）
 */
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') {
      cur += '\\|';
      k++;
      continue;
    }
    if (s[k] === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += s[k];
  }
  cells.push(cur.trim());
  return cells;
}

/** 判断是否为表格分隔行，如 | --- | :---: | */
function isTableSeparator(line) {
  if (line.indexOf('|') === -1) return false;
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => RE_TABLE_SEP_CELL.test(c));
}

/** 判断第 i 行是否为表格起点（当前行含 | 且下一行是列数一致的分隔行） */
function isTableStart(lines, i) {
  if (i + 1 >= lines.length) return false;
  if (lines[i].indexOf('|') === -1) return false;
  if (!isTableSeparator(lines[i + 1])) return false;
  return splitTableRow(lines[i]).length === splitTableRow(lines[i + 1]).length;
}

/** 解析对齐方式：:--- 左对齐，---: 右对齐，:---: 居中 */
function parseAlign(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return '';
}

/** 判断第 i 行是否会打断段落（即某个块级结构的起点） */
function isBlockStart(lines, i) {
  const line = lines[i];
  return (
    RE_FENCE_OPEN.test(line) ||
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    matchListItem(line) !== null ||
    isTableStart(lines, i)
  );
}

/**
 * 解析列表（递归入口）：从 lines[start] 开始解析一个完整列表
 * 返回 { node, next }，next 为列表结束后的下一行下标
 *
 * 嵌套原理：续行剥掉"标记宽度"的缩进后，交给 parseLines 递归解析，
 * 因此子列表（缩进 2 或 4 空格）会在递归中被重新识别为列表。
 */
function parseList(lines, start) {
  const first = matchListItem(lines[start]);
  const baseIndent = first.indent;
  const ordered = first.ordered;
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = matchListItem(lines[i]);
    // 缩进层级或列表类型变化 -> 列表结束
    if (!m || m.indent !== baseIndent || m.ordered !== ordered) break;

    const contentIndent = baseIndent + m.markerWidth;
    const itemLines = [m.content];
    i++;

    // 收集属于当前列表项的续行（缩进对齐的内容，含空行分隔的多段落）
    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === '') {
        // 预读下一个非空行，判断空行之后的内容是否仍属于本列表项
        let j = i;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j >= lines.length) { i = j; break; }
        const nextItem = matchListItem(lines[j]);
        if (nextItem && nextItem.indent === baseIndent) { i = j; break; } // 下一个同级列表项
        if (indentOf(lines[j]) > baseIndent) { 
          itemLines.push(''); // 项内空行 -> 多段落
          i++;
          continue;
        }
        i = j; // 列表整体结束
        break;
      }

      const ind = indentOf(line);
      const asItem = matchListItem(line);
      if (asItem && asItem.indent === baseIndent) break; // 同级下一项
      // 缩进不足且不是更深层级的子列表项 -> 列表结束
      if (ind < contentIndent && !(asItem && asItem.indent > baseIndent)) break;

      itemLines.push(stripIndent(line, contentIndent));
      i++;
    }

    // 递归解析列表项内容（可能包含段落、子列表、引用等）
    items.push(parseLines(itemLines).blocks);
  }

  return { node: { type: 'list', ordered, items }, next: i };
}

/**
 * 核心：把一组行解析为块级 AST
 * 返回 { blocks, next }
 */
function parseLines(lines) {
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行：跳过
    if (line.trim() === '') { i++; continue; }

    // 围栏代码块：内部内容原样保留，不做任何解析
    const fence = RE_FENCE_OPEN.exec(line);
    if (fence) {
      const codeLines = [];
      i++;
      while (i < lines.length && !RE_FENCE_CLOSE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 跳过闭合围栏（未闭合则消费到文末，不报错）
      blocks.push({ type: 'code', lang: fence[1] || '', code: codeLines.join('\n') });
      continue;
    }

    // 标题
    const heading = RE_HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    // 水平线（必须先于列表判断，避免 * * * 被当成列表）
    if (RE_HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 引用块：连续引用行剥离 > 后递归解析（>> 嵌套、引用内列表由此支持）
    if (RE_QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length) {
        const qm = RE_QUOTE.exec(lines[i]);
        if (!qm) break;
        inner.push(qm[1]);
        i++;
      }
      blocks.push({ type: 'quote', children: parseLines(inner).blocks });
      continue;
    }

    // 表格
    if (isTableStart(lines, i)) {
      const header = splitTableRow(lines[i]);
      const aligns = splitTableRow(lines[i + 1]).map(parseAlign);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') !== -1) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header, aligns, rows });
      continue;
    }

    // 列表
    if (matchListItem(line)) {
      const parsed = parseList(lines, i);
      blocks.push(parsed.node);
      i = parsed.next;
      continue;
    }

    // 段落：收集到空行或下一个块级起点为止
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines, i)) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', text: para.join('\n') });
  }

  return { blocks, next: i };
}

/**
 * 对外入口：Markdown 源文本 -> 块级 AST
 */
function parseBlocks(source) {
  const lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
  return parseLines(lines).blocks;
}


/* ==================== src/renderer.js ==================== */
// ============================================================
// 渲染器：把块级 AST 渲染为 HTML 字符串
// 行内文本在此调用 parseInline 完成行内解析
// ============================================================


/** 渲染列表项：单段落项直接内联渲染，多块项保留块级结构 */
function renderListItem(blocks) {
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return parseInline(blocks[0].text);
  }
  return '\n' + renderBlocks(blocks) + '\n';
}

/** 渲染单个块 */
function renderBlock(block) {
  switch (block.type) {
    case 'heading':
      return '<h' + block.level + '>' + parseInline(block.text) + '</h' + block.level + '>';

    case 'paragraph':
      return '<p>' + parseInline(block.text) + '</p>';

    case 'code': {
      // 代码内容整体转义，内部任何 Markdown 语法都不会被解析
      const langClass = block.lang ? ' class="language-' + escapeHtml(block.lang) + '"' : '';
      const label = block.lang ? '<span class="code-lang">' + escapeHtml(block.lang) + '</span>' : '';
      return '<pre>' + label + '<code' + langClass + '>' + escapeHtml(block.code) + '</code></pre>';
    }

    case 'quote':
      return '<blockquote>\n' + renderBlocks(block.children) + '\n</blockquote>';

    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items
        .map((item) => '<li>' + renderListItem(item) + '</li>')
        .join('\n');
      return '<' + tag + '>\n' + items + '\n</' + tag + '>';
    }

    case 'table': {
      const alignStyle = (i) => {
        const a = block.aligns[i];
        return a ? ' style="text-align:' + a + '"' : '';
      };
      const head = block.header
        .map((cell, i) => '<th' + alignStyle(i) + '>' + parseInline(cell) + '</th>')
        .join('');
      const bodyRows = block.rows.map((row) => {
        const cells = [];
        for (let i = 0; i < block.header.length; i++) {
          cells.push('<td' + alignStyle(i) + '>' + parseInline(row[i] || '') + '</td>');
        }
        return '<tr>' + cells.join('') + '</tr>';
      });
      return '<table>\n<thead><tr>' + head + '</tr></thead>\n<tbody>\n'
        + bodyRows.join('\n') + '\n</tbody>\n</table>';
    }

    case 'hr':
      return '<hr>';

    default:
      // 未知块类型：不崩溃，按段落兜底输出
      return '<p>' + escapeHtml(JSON.stringify(block)) + '</p>';
  }
}

/** 渲染块数组 */
function renderBlocks(blocks) {
  return blocks.map(renderBlock).join('\n');
}

/** 对外入口：AST -> HTML */
function render(blocks) {
  return renderBlocks(blocks);
}


/* ==================== src/tests.js ==================== */
// ============================================================
// 内置测试套件：28 条断言
// 每条断言给定 Markdown 输入，校验生成 HTML 的关键结构
// check 返回 true 表示通过，返回字符串表示失败原因（会被展示，绝不静默吞掉）
// ============================================================


/** Markdown -> HTML */
function toHtml(src) {
  return render(parseBlocks(src));
}

/** 用 DOMParser 做结构化查询 */
function query(html, selector) {
  return new DOMParser().parseFromString(html, 'text/html').querySelector(selector);
}

function queryAll(html, selector) {
  return new DOMParser().parseFromString(html, 'text/html').querySelectorAll(selector);
}

/** 组装失败详情（附带实际 HTML，截断展示） */
function fail(msg, html) {
  const snippet = html.length > 300 ? html.slice(0, 300) + ' ...' : html;
  return msg + '\n实际 HTML：' + snippet;
}

const tests = [
  // ---------- 标题 ----------
  {
    name: '一级标题渲染为 <h1>',
    input: '# 你好世界',
    check: (h) => h.includes('<h1>你好世界</h1>') || fail('未生成 <h1>你好世界</h1>', h),
  },
  {
    name: '六级标题渲染为 <h6>',
    input: '###### 最深的标题',
    check: (h) => h.includes('<h6>最深的标题</h6>') || fail('未生成 <h6>', h),
  },
  {
    name: '# 后无空格不视为标题',
    input: '#这不是标题',
    check: (h) => (h.includes('<p>#这不是标题</p>') && !h.includes('<h1')) || fail('应原样输出为段落', h),
  },

  // ---------- 段落与换行 ----------
  {
    name: '空行分隔为两个段落',
    input: '第一段\n\n第二段',
    check: (h) => queryAll(h, 'p').length === 2 || fail('应生成 2 个 <p>', h),
  },
  {
    name: '行尾两个空格产生 <br> 强制换行',
    input: '第一行  \n第二行',
    check: (h) => h.includes('<br>') || fail('未生成 <br>', h),
  },

  // ---------- 强调 ----------
  {
    name: '*斜体* 渲染为 <em>',
    input: '这是 *斜体* 文字',
    check: (h) => h.includes('<em>斜体</em>') || fail('未生成 <em>', h),
  },
  {
    name: '**粗体** 渲染为 <strong>',
    input: '这是 **粗体** 文字',
    check: (h) => h.includes('<strong>粗体</strong>') || fail('未生成 <strong>', h),
  },
  {
    name: '***粗斜体*** 渲染为嵌套 <strong><em>',
    input: '***粗斜体***',
    check: (h) => h.includes('<strong><em>粗斜体</em></strong>') || fail('未生成粗斜体嵌套标签', h),
  },
  {
    name: '~~删除线~~ 渲染为 <del>',
    input: '~~已删除~~',
    check: (h) => h.includes('<del>已删除</del>') || fail('未生成 <del>', h),
  },
  {
    name: '行内代码中的 * 不解析为斜体',
    input: '代码 `*a*` 结束',
    check: (h) => (h.includes('<code>*a*</code>') && !h.includes('<em>')) || fail('行内代码内容被错误解析', h),
  },

  // ---------- 链接与图片 ----------
  {
    name: '链接渲染为 <a href>',
    input: '[百度](https://www.baidu.com)',
    check: (h) => h.includes('<a href="https://www.baidu.com">百度</a>') || fail('链接渲染错误', h),
  },
  {
    name: 'javascript: 协议被过滤',
    input: '[点我](javascript:alert(1))',
    check: (h) => (!h.includes('<a ') && !h.includes('href="javascript:')) || fail('危险协议未被过滤', h),
  },
  {
    name: '图片渲染为 <img>',
    input: '![图标](icon.png)',
    check: (h) => h.includes('<img src="icon.png" alt="图标">') || fail('图片渲染错误', h),
  },

  // ---------- 列表 ----------
  {
    name: '无序列表生成 <ul><li>',
    input: '- 苹果\n- 香蕉',
    check: (h) => queryAll(h, 'ul > li').length === 2 || fail('无序列表项数量错误', h),
  },
  {
    name: '有序列表生成 <ol><li>',
    input: '1. 第一步\n2. 第二步',
    check: (h) => queryAll(h, 'ol > li').length === 2 || fail('有序列表项数量错误', h),
  },
  {
    name: '列表支持三层嵌套（ul ul ul）',
    input: '- 一层\n  - 二层\n    - 三层',
    check: (h) => {
      const deepest = query(h, 'ul ul ul li');
      return (deepest && deepest.textContent.includes('三层')) || fail('三层嵌套结构缺失', h);
    },
  },
  {
    name: '无序列表中可嵌套有序列表',
    input: '- 水果\n  1. 苹果\n  2. 香蕉',
    check: (h) => queryAll(h, 'ul ol > li').length === 2 || fail('混合嵌套列表结构错误', h),
  },
  {
    name: '列表项可包含多段落',
    input: '- 第一段\n\n  第二段',
    check: (h) => queryAll(h, 'li > p').length === 2 || fail('列表项内应包含 2 个段落', h),
  },

  // ---------- 代码块 ----------
  {
    name: '代码块内的 Markdown 语法不被解析',
    input: ['```', '*不是斜体* # 不是标题 `code`', '```'].join('\n'),
    check: (h) => {
      const code = query(h, 'pre code');
      return (code && code.textContent.includes('*不是斜体* # 不是标题 `code`') && !h.includes('<em>') && !h.includes('<h1'))
        || fail('代码块内容被错误解析', h);
    },
  },
  {
    name: '代码块语言标注生成 language- 类名与标签',
    input: ['```js', 'console.log(1)', '```'].join('\n'),
    check: (h) => (h.includes('class="language-js"') && h.includes('>js</span>')) || fail('语言标注缺失', h),
  },

  // ---------- 引用块 ----------
  {
    name: '引用块渲染为 <blockquote>',
    input: '> 这是一段引用',
    check: (h) => {
      const bq = query(h, 'blockquote p');
      return (bq && bq.textContent.includes('这是一段引用')) || fail('引用块渲染错误', h);
    },
  },
  {
    name: '>> 嵌套引用生成嵌套 blockquote',
    input: '> 外层\n> > 内层',
    check: (h) => {
      const inner = query(h, 'blockquote blockquote');
      return (inner && inner.textContent.includes('内层')) || fail('嵌套引用结构缺失', h);
    },
  },
  {
    name: '引用块内可包含列表',
    input: '> - 甲\n> - 乙',
    check: (h) => queryAll(h, 'blockquote ul > li').length === 2 || fail('引用内列表结构错误', h),
  },

  // ---------- 表格 ----------
  {
    name: '表格生成 <table> 且列数正确',
    input: '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |',
    check: (h) => (queryAll(h, 'th').length === 2 && queryAll(h, 'tbody td').length === 2) || fail('表格列数错误', h),
  },
  {
    name: '表格支持 :--- 对齐方式',
    input: '| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| a | b | c |',
    check: (h) => (h.includes('text-align:left') && h.includes('text-align:center') && h.includes('text-align:right'))
      || fail('对齐样式缺失', h),
  },

  // ---------- 水平线 ----------
  {
    name: '--- 渲染为 <hr>',
    input: '上文\n\n---\n\n下文',
    check: (h) => h.includes('<hr>') || fail('未生成 <hr>', h),
  },
  {
    name: '*** 与 ___ 也渲染为 <hr>',
    input: '***\n\n___',
    check: (h) => queryAll(h, 'hr').length === 2 || fail('*** 或 ___ 未生成 <hr>', h),
  },

  // ---------- 转义 ----------
  {
    name: '\\* 转义后按普通文本输出',
    input: '\\*这不是斜体\\*',
    check: (h) => (h.includes('*这不是斜体*') && !h.includes('<em>')) || fail('转义字符被错误解析', h),
  },
  {
    name: '\\` 转义后不生成行内代码',
    input: '\\`不是代码\\`',
    check: (h) => (h.includes('`不是代码`') && !h.includes('<code>')) || fail('反引号转义失效', h),
  },

  // ---------- 健壮性 ----------
  {
    name: '未闭合的 ** 按普通文本输出',
    input: '**没有闭合',
    check: (h) => (h.includes('**没有闭合') && !h.includes('<strong>')) || fail('未闭合强调应原样输出', h),
  },
  {
    name: '未闭合的代码围栏不崩溃',
    input: ['```js', 'let a = 1'].join('\n'),
    check: (h) => h.includes('let a = 1') || fail('未闭合代码围栏处理失败', h),
  },
  {
    name: '各种非法输入均不抛异常',
    input: '[broken](\n\n![alt\n\n`\n\n|\n\n***\n\n> ',
    check: (h) => typeof h === 'string' || fail('解析过程抛异常', h),
  },
  {
    name: '空输入返回空字符串',
    input: '',
    check: (h) => h === '' || fail('空输入应输出空字符串', h),
  },
];

/**
 * 运行全部断言，返回 [{ name, pass, detail }]
 * 单条断言抛异常会被捕获并记为失败，不影响其他断言
 */
function runTests() {
  return tests.map((t) => {
    try {
      const html = toHtml(t.input);
      const result = t.check(html);
      return { name: t.name, pass: result === true, detail: result === true ? '' : String(result) };
    } catch (err) {
      return { name: t.name, pass: false, detail: '断言执行抛出异常：' + (err && err.message) };
    }
  });
}

/** 断言总数（供 UI 展示） */
const TEST_COUNT = tests.length;


/* ==================== src/ui.js ==================== */
// ============================================================
// UI 模块：DOM 交互、内置示例、复制、清空、测试结果渲染
// ============================================================

/** 内置示例（用行数组拼接，避免反引号转义困扰） */
const EXAMPLES = [
  {
    name: '完整语法示例',
    source: [
      '# Markdown 渲染器',
      '',
      '这是一个**纯前端**、*零依赖*的 Markdown 渲染器，解析器完全手写。',
      '支持 ***粗斜体***、~~删除线~~、`行内代码` 等行内语法。',
      '',
      '## 链接与图片',
      '',
      '[访问 GitHub](https://github.com) 与 ![示例图片](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiIHJ4PSI2IiBmaWxsPSIjNThhNmZmIi8+PHRleHQgeD0iNjAiIHk9IjM2IiBmb250LXNpemU9IjE0IiBmb250LWZhbWlseT0ibW9ub3NwYWNlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjZmZmZmZmIj5ERU1PPC90ZXh0Pjwvc3ZnPg==)',
      '',
      '## 列表',
      '',
      '- 无序列表项 A',
      '- 无序列表项 B',
      '',
      '1. 有序列表项一',
      '2. 有序列表项二',
      '',
      '## 代码块',
      '',
      '```js',
      'function hello() {',
      '  console.log("这里的 * 和 # 不会被解析");',
      '}',
      '```',
      '',
      '## 引用',
      '',
      '> 这是一段引用。',
      '',
      '## 表格',
      '',
      '| 语法 | 效果 |',
      '| :--- | ---: |',
      '| **粗体** | 加粗文字 |',
      '| *斜体* | 倾斜文字 |',
      '',
      '---',
      '',
      '以上是全部基础语法。',
    ].join('\n'),
  },
  {
    name: '嵌套列表与引用示例',
    source: [
      '# 嵌套结构演示',
      '',
      '## 三层嵌套列表',
      '',
      '- 第一层 A',
      '  - 第二层 A1',
      '    - 第三层 A1a',
      '    - 第三层 A1b',
      '  - 第二层 A2',
      '- 第一层 B',
      '',
      '## 混合嵌套',
      '',
      '1. 有序第一层',
      '   - 无序第二层',
      '     1. 有序第三层',
      '2. 有序第一层',
      '',
      '## 列表项多段落',
      '',
      '- 这是列表项的第一段。',
      '',
      '  这是同一个列表项的第二段，缩进对齐后仍属于该列表项。',
      '',
      '- 第二个列表项。',
      '',
      '## 嵌套引用',
      '',
      '> 第一层引用',
      '> > 第二层引用',
      '> > > 第三层引用',
      '',
      '## 引用中包含列表',
      '',
      '> 引用中的待办：',
      '> - 事项一',
      '> - 事项二',
      '>   - 子事项',
    ].join('\n'),
  },
  {
    name: '转义与代码块示例',
    source: [
      '# 转义与代码块',
      '',
      '## 反斜杠转义',
      '',
      '\\*这不是斜体\\*，\\`这不是代码\\`，\\# 这不是标题。',
      '',
      '## 行内代码优先',
      '',
      '行内代码 `*不会* **被解析**` 中的符号原样输出。',
      '',
      '## 代码块原样保留',
      '',
      '```markdown',
      '# 代码块里的标题不是标题',
      '* 代码块里的星号不是斜体',
      '`反引号也原样显示`',
      '```',
      '',
      '## 危险协议过滤',
      '',
      '[这个链接的 javascript: 协议会被过滤](javascript:alert(1))',
      '',
      '## 未闭合语法容错',
      '',
      '**这段粗体没有闭合，按普通文本输出。',
    ].join('\n'),
  },
];

/** 获取页面全部 DOM 引用 */
function getElements() {
  return {
    editor: document.getElementById('editor'),
    preview: document.getElementById('preview'),
    parseTime: document.getElementById('parse-time'),
    exampleSelect: document.getElementById('example-select'),
    btnCopy: document.getElementById('btn-copy'),
    btnClear: document.getElementById('btn-clear'),
    btnTest: document.getElementById('btn-test'),
    testPanel: document.getElementById('test-panel'),
    testSummary: document.getElementById('test-summary'),
    testResults: document.getElementById('test-results'),
    toast: document.getElementById('toast'),
  };
}

let toastTimer = null;

/** 右下角轻提示 */
function showToast(el, message, isError) {
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.toggle('toast-error', !!isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2000);
}

/** 复制文本到剪贴板（file:// 环境下 clipboard API 可能不可用，自动降级 execCommand） */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

/** 渲染测试结果面板：每条断言的通过/失败与失败详情 */
function renderTestResults(els, results) {
  els.testPanel.classList.remove('hidden');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  els.testSummary.textContent = '共 ' + results.length + ' 条断言：通过 ' + passed + '，失败 ' + failed;
  els.testSummary.classList.toggle('all-pass', failed === 0);
  els.testSummary.classList.toggle('has-fail', failed > 0);

  els.testResults.innerHTML = '';
  results.forEach((r, idx) => {
    const li = document.createElement('li');
    li.className = r.pass ? 'pass' : 'fail';
    const head = document.createElement('span');
    head.className = 'test-name';
    head.textContent = (r.pass ? '✓ ' : '✗ ') + (idx + 1) + '. ' + r.name;
    li.appendChild(head);
    if (!r.pass && r.detail) {
      const pre = document.createElement('pre');
      pre.className = 'test-detail';
      pre.textContent = r.detail;
      li.appendChild(pre);
    }
    els.testResults.appendChild(li);
  });
}


/* ==================== src/main.js ==================== */
// ============================================================
// 入口：装配解析管线与 UI 事件
// 数据流：textarea 输入 -> 300ms 防抖 -> parseBlocks -> render -> 预览区
// ============================================================


const els = getElements();
const DEBOUNCE_MS = 300;
let debounceTimer = null;

/** 解析 + 渲染，返回 HTML 与耗时（毫秒） */
function pipeline(source) {
  const start = performance.now();
  const html = render(parseBlocks(source));
  const cost = performance.now() - start;
  return { html, cost };
}

/** 刷新预览区与耗时显示 */
function updatePreview() {
  try {
    const { html, cost } = pipeline(els.editor.value);
    els.preview.innerHTML = html;
    els.parseTime.textContent = cost.toFixed(2) + ' ms';
  } catch (err) {
    // 解析器不应抛异常；万一抛出，展示错误而不是让页面崩溃
    els.preview.textContent = '解析出错：' + (err && err.message);
    els.parseTime.textContent = '出错';
  }
}

/** 输入事件：300ms 防抖后重新渲染 */
els.editor.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(updatePreview, DEBOUNCE_MS);
});

/** 加载示例 */
EXAMPLES.forEach((ex, i) => {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = ex.name;
  els.exampleSelect.appendChild(opt);
});
els.exampleSelect.addEventListener('change', () => {
  const idx = Number(els.exampleSelect.value);
  if (Number.isNaN(idx) || !EXAMPLES[idx]) return;
  els.editor.value = EXAMPLES[idx].source;
  updatePreview();
});

/** 复制渲染后的 HTML */
els.btnCopy.addEventListener('click', async () => {
  const ok = await copyText(els.preview.innerHTML);
  showToast(els.toast, ok ? 'HTML 已复制到剪贴板' : '复制失败，请手动复制', !ok);
});

/** 清空编辑区与预览区 */
els.btnClear.addEventListener('click', () => {
  els.editor.value = '';
  els.exampleSelect.value = '';
  updatePreview();
  els.editor.focus();
});

/** 运行内置测试 */
els.btnTest.addEventListener('click', () => {
  const results = runTests();
  renderTestResults(els, results);
  const failed = results.filter((r) => !r.pass).length;
  showToast(
    els.toast,
    failed === 0 ? '全部 ' + results.length + ' 条断言通过' : '有 ' + failed + ' 条断言失败',
    failed > 0
  );
  els.testPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// 初始加载第一个示例并渲染
els.editor.value = EXAMPLES[0].source;
els.exampleSelect.value = '0';
updatePreview();
