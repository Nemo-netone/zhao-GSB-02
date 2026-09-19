// ============================================================
// 渲染器：把块级 AST 渲染为 HTML 字符串
// 行内文本在此调用 parseInline 完成行内解析
// ============================================================

import { parseInline, escapeHtml } from './inline-parser.js';

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
export function renderBlocks(blocks) {
  return blocks.map(renderBlock).join('\n');
}

/** 对外入口：AST -> HTML */
export function render(blocks) {
  return renderBlocks(blocks);
}