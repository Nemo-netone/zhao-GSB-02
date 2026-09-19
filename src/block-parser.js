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
export function parseBlocks(source) {
  const lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
  return parseLines(lines).blocks;
}