// src/block-parser.js
// 块级解析器：递归下降，把 Markdown 文本切成块级 AST。
// 支持：标题、段落（强制换行）、围栏代码块、引用（嵌套）、
// 无序/有序列表（2 或 4 空格缩进嵌套，多段落列表项）、
// 表格（含对齐）、水平线。任何无法识别的内容退化为普通段落。

import { HARD_BREAK } from './inline-parser.js';

const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})([^\n]*)$/;
const HR_RE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1[ \t]*){2,}$/;
const UL_RE = /^(\s*)([-*+])([ \t]+)(.*)$/;
const OL_RE = /^(\s*)(\d{1,9})([.)])([ \t]+)(.*)$/;
const QUOTE_RE = /^(\s*)>( ?)(.*)$/;
const TABLE_SEP_RE = /^\s*:?-{1,}:?\s*$/;

// 预处理：\r\n 归一、tab 展开（4 空格 tab stop）
function preprocess(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  return normalized.split('\n').map((line) => {
    let result = '';
    for (const ch of line) {
      if (ch === '\t') result += ' '.repeat(4 - (result.length % 4));
      else result += ch;
    }
    return result;
  });
}

function isBlank(line) {
  return line.trim() === '';
}

// 一行是否“看起来像块级结构的开头”（用于懒续行的边界判定）
function looksLikeBlockStart(line) {
  if (isBlank(line)) return false;
  if (HEADING_RE.test(line)) return true;
  if (FENCE_RE.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (UL_RE.test(line)) return true;
  if (OL_RE.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  return false;
}

function dedent(line, spaces) {
  let removed = 0;
  let i = 0;
  while (removed < spaces && i < line.length && line[i] === ' ') {
    removed++;
    i++;
  }
  return line.slice(i);
}

/**
 * 块级解析入口。
 * @param {string} markdown 原始 Markdown 文本
 * @returns {{type:'document', children:Array}}
 */
export function parseBlocks(markdown) {
  const lines = preprocess(markdown);
  const children = parseLines(lines, 0, lines.length, 0);
  return { type: 'document', children };
}

/**
 * 解析 lines[start..end) 中 indent 列以上的内容。
 */
function parseLines(lines, start, end, indent) {
  const blocks = [];
  let i = start;

  while (i < end) {
    const line = lines[i];
    const view = dedent(line, indent);

    if (isBlank(view)) { i++; continue; }

    const fenceMatch = view.match(FENCE_RE);
    if (fenceMatch) {
      const result = consumeFencedCode(lines, i, end, indent);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    const headingMatch = view.match(HEADING_RE);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: (headingMatch[2] || '').trim() });
      i++;
      continue;
    }

    if (HR_RE.test(view)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    const quoteMatch = view.match(QUOTE_RE);
    if (quoteMatch) {
      const result = consumeBlockquote(lines, i, end, indent);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    if (UL_RE.test(view) || OL_RE.test(view)) {
      const result = consumeList(lines, i, end, indent);
      blocks.push(result.block);
      i = result.next;
      continue;
    }

    if (view.indexOf('|') !== -1) {
      const result = consumeTable(lines, i, end, indent);
      if (result) {
        blocks.push(result.block);
        i = result.next;
        continue;
      }
    }

    const result = consumeParagraph(lines, i, end, indent);
    blocks.push(result.block);
    i = result.next;
  }

  return blocks;
}

// ---------- 围栏代码块 ----------
function consumeFencedCode(lines, start, end, indent) {
  const openMatch = dedent(lines[start], indent).match(FENCE_RE);
  const marker = openMatch[2][0];
  const markerLength = openMatch[2].length;
  const lang = openMatch[3].trim();
  const fenceIndent = indent + openMatch[1].length;

  const raw = [];
  let i = start + 1;
  while (i < end) {
    const view = dedent(lines[i], fenceIndent);
    const close = view.match(/^(\s*)(`{3,}|~{3,})\s*$/);
    if (close && close[2][0] === marker && close[2].length >= markerLength && close[1].length === 0) {
      i++;
      return { block: { type: 'codeBlock', lang, value: raw.join('\n'), closed: true }, next: i };
    }
    raw.push(view);
    i++;
  }
  // 未闭合的围栏也按代码块处理，内容原样输出，保证不崩溃
  return { block: { type: 'codeBlock', lang, value: raw.join('\n'), closed: false }, next: i };
}

// ---------- 引用块（支持嵌套，内容可为列表等任意块） ----------
function consumeBlockquote(lines, start, end, indent) {
  const innerLines = [];
  let i = start;
  let hadBlank = false;

  while (i < end) {
    const view = dedent(lines[i], indent);
    if (isBlank(view)) {
      hadBlank = true;
      i++;
      continue;
    }
    const q = view.match(QUOTE_RE);
    if (q) {
      hadBlank = false;
      innerLines.push(' '.repeat(q[1].length) + q[3]); // 去掉 "> "，最多吃一个空格
      i++;
      continue;
    }
    // 懒续行：空行之后的普通行不再属于引用
    if (hadBlank) break;
    innerLines.push(view);
    i++;
  }

  while (innerLines.length && isBlank(innerLines[innerLines.length - 1])) innerLines.pop();
  const children = parseLines(innerLines, 0, innerLines.length, 0);
  return { block: { type: 'blockquote', children }, next: i };
}

// ---------- 列表 ----------
function parseListItemMarker(line) {
  const ul = line.match(UL_RE);
  if (ul) {
    return {
      ordered: false,
      markerIndent: ul[1].length,
      contentColumn: ul[1].length + ul[2].length + ul[3].length,
      text: ul[4],
      delimiter: ul[2]
    };
  }
  const ol = line.match(OL_RE);
  if (ol) {
    return {
      ordered: true,
      markerIndent: ol[1].length,
      contentColumn: ol[1].length + ol[2].length + 1 + ol[4].length,
      text: ol[5],
      order: parseInt(ol[2], 10),
      delimiter: ol[3]
    };
  }
  return null;
}

function markerInfo(view) {
  const m = parseListItemMarker(view);
  if (!m) return null;
  // 标记后空白的结束位置（允许 tab，预处理已把 tab 展开为空格）
  const afterMarker = m.markerIndent + (m.ordered ? m.delimiter.length + 1 : 1);
  let spaces = 0;
  while (afterMarker + spaces < view.length && view[afterMarker + spaces] === ' ') spaces++;
  let contentColumn = afterMarker + spaces;
  if (spaces > 4) contentColumn = afterMarker + 1; // CommonMark：超过 4 空格按 1 空格缩进来对齐
  return {
    ordered: m.ordered,
    markerIndent: m.markerIndent,
    delimiter: m.delimiter,
    order: m.order,
    contentColumn,
    text: view.slice(afterMarker + Math.min(spaces, contentColumn - afterMarker))
  };
}

function consumeList(lines, start, end, indent) {
  const first = markerInfo(dedent(lines[start], indent));
  const ordered = first.ordered;
  const delimiter = first.delimiter;

  const items = [];
  let i = start;
  let looseFlag = false;

  while (i < end) {
    const view = dedent(lines[i], indent);
    if (isBlank(view)) {
      let j = i + 1;
      while (j < end && isBlank(dedent(lines[j], indent))) j++;
      if (j >= end) break;
      const afterView = dedent(lines[j], indent);
      const afterMarker = markerInfo(afterView);
      const sameMarker = afterMarker && afterMarker.markerIndent === first.markerIndent &&
        afterMarker.ordered === ordered && afterMarker.delimiter === delimiter;
      if (!sameMarker && afterView[0] !== ' ') break;
      i = j;
      continue;
    }

    const marker = markerInfo(view);
    if (!marker || marker.markerIndent !== first.markerIndent) break;

    const itemLines = [marker.text];
    const itemIndent = marker.contentColumn;
    i++;
    let looseThisItem = false;

    while (i < end) {
      const current = dedent(lines[i], indent);
      if (isBlank(current)) {
        let j = i + 1;
        while (j < end && isBlank(dedent(lines[j], indent))) j++;
        if (j >= end) { i = end; break; }
        const nextView = dedent(lines[j], indent);
        const nextMarker = markerInfo(nextView);
        const nextSame = nextMarker && nextMarker.markerIndent === first.markerIndent &&
          nextMarker.ordered === ordered && nextMarker.delimiter === delimiter;
        if (nextSame) { looseThisItem = true; break; } // 空行分隔的下一个列表项
        if (nextView[0] !== ' ') { i = j; break; }
        itemLines.push('');
        i = j;
        continue;
      }

      const currentMarker = markerInfo(current);
      if (currentMarker && currentMarker.markerIndent === first.markerIndent) break;

      if (current[0] === ' ') {
        // 缩进行统一剥掉 itemIndent 列：普通续行因此到第 0 列，
        // 嵌套列表标记则保留 (markerIndent - itemIndent) 的相对缩进
        itemLines.push(dedent(current, itemIndent));
      } else if (looksLikeBlockStart(current)) {
        break;
      } else {
        itemLines.push(current); // 懒续行
      }
      i++;
    }

    while (itemLines.length && isBlank(itemLines[itemLines.length - 1])) itemLines.pop();
    const children = parseLines(itemLines, 0, itemLines.length, 0);
    const innerLoose = itemHasBlankBetweenContent({ children });
    items.push({ type: 'listItem', children });
    if (looseThisItem || innerLoose) looseFlag = true;
  }

  // 松散判定：任一列表项内部存在“内容之间的空行”，或项之间被空行分隔
  const loose = looseFlag;
  return {
    block: { type: 'list', ordered, start: ordered ? first.order : null, loose, items },
    next: i
  };
}

function itemHasBlankBetweenContent(item) {
  const walk = (blocks) => {
    for (const block of blocks) {
      if (block.type === 'list') {
        if (block.items.some((child) => itemHasBlankBetweenContent(child))) return true;
      }
    }
    return false;
  };
  // 同一列表项里出现两个及以上“非列表”块，通常意味着空行分隔（多段落/段落+代码块等）
  const major = item.children.filter((block) => block.type !== 'list');
  if (major.length >= 2) return true;
  return walk(item.children);
}
// ---------- 表格 ----------
function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) {
    trimmed = trimmed.slice(0, -1);
  }
  const cells = [];
  let current = '';
  for (let k = 0; k < trimmed.length; k++) {
    const ch = trimmed[k];
    if (ch === '\\' && trimmed[k + 1] === '|') {
      current += '|';
      k++;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function consumeTable(lines, start, end, indent) {
  const header = dedent(lines[start], indent);
  const separator = start + 1 < end ? dedent(lines[start + 1], indent) : null;
  if (!separator || separator.indexOf('|') === -1) return null;

  const headerCells = splitTableRow(header);
  const sepCells = splitTableRow(separator);
  if (headerCells.length < 2 || sepCells.length !== headerCells.length) return null;
  if (!sepCells.every((cell) => TABLE_SEP_RE.test(cell))) return null;

  const aligns = sepCells.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':') && cell.length > 1;
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });

  const rows = [];
  let i = start + 2;
  while (i < end) {
    const view = dedent(lines[i], indent);
    if (isBlank(view) || view.indexOf('|') === -1) break;
    const cells = splitTableRow(view);
    while (cells.length < headerCells.length) cells.push('');
    rows.push(cells.slice(0, headerCells.length));
    i++;
  }

  return {
    block: { type: 'table', header: headerCells, aligns, rows },
    next: i
  };
}

// ---------- 段落 ----------
function consumeParagraph(lines, start, end, indent) {
  const collected = [];
  let i = start;
  while (i < end) {
    const view = dedent(lines[i], indent);
    if (isBlank(view)) break;
    if (collected.length > 0) {
      if (FENCE_RE.test(view) || HR_RE.test(view) || QUOTE_RE.test(view)) break;
      if (UL_RE.test(view)) break;
      const olStart = view.match(OL_RE);
      if (olStart && parseInt(olStart[2], 10) === 1) break;
    }
    collected.push(view);
    i++;
  }

  // “行尾两空格” -> 强制换行标记；其余换行保留为软换行
  const text = collected
    .map((line) => line.replace(/  $/u, HARD_BREAK).replace(/[ \t]+$/u, ''))
    .join('\n');

  return { block: { type: 'paragraph', text }, next: i };
}






