// src/renderer.js
// AST -> HTML 渲染器。
// 块节点的行内内容在此阶段才调用 parseInline，做到“先块级、后行内”。
// 所有动态文本统一经 escapeHtml/escapeAttr 转义；
// 链接 URL 过滤 javascript: / vbscript: 等危险协议。

import { parseInline } from './inline-parser.js';

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(text) {
  return escapeHtml(text);
}

// 危险协议过滤：仅拦截明确的脚本类协议，http(s)/相对路径/mailto/锚点等放行
function safeUrl(rawUrl) {
  const url = String(rawUrl ?? '').trim().replace(/[\u0000-\u0020]+/g, '');
  if (url === '') return '';
  const protocolMatch = url.match(/^([a-z][a-z0-9+.\-]*):/i);
  if (!protocolMatch) return url; // 相对路径、#anchor 等
  const scheme = protocolMatch[1].toLowerCase();
  if (scheme === 'javascript' || scheme === 'vbscript' || scheme === 'file') {
    return '';
  }
  return url;
}

function renderInlineNodes(nodes) {
  let html = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        html += escapeHtml(node.value);
        break;
      case 'code':
        html += '<code class="md-code-inline">' + escapeHtml(node.value) + '</code>';
        break;
      case 'em':
        html += '<em>' + renderInlineNodes(node.children) + '</em>';
        break;
      case 'strong':
        html += '<strong>' + renderInlineNodes(node.children) + '</strong>';
        break;
      case 'strongEm':
        html += '<strong><em>' + renderInlineNodes(node.children) + '</em></strong>';
        break;
      case 'strike':
        html += '<del>' + renderInlineNodes(node.children) + '</del>';
        break;
      case 'link': {
        const href = safeUrl(node.url);
        const title = node.title ? ' title="' + escapeAttr(node.title) + '"' : '';
        if (href) {
          html += '<a href="' + escapeAttr(href) + '"' + title + ' target="_blank" rel="noopener noreferrer">' +
            renderInlineNodes(node.children) + '</a>';
        } else {
          // 危险协议：不输出可执行链接，仅保留文本并给出语义标记
          html += '<span class="md-unsafe-link" title="已拦截不安全的链接协议">' +
            renderInlineNodes(node.children) + '</span>';
        }
        break;
      }
      case 'image': {
        const src = safeUrl(node.url);
        const alt = escapeAttr(node.alt || '');
        const title = node.title ? ' title="' + escapeAttr(node.title) + '"' : '';
        if (src) {
          html += '<img src="' + escapeAttr(src) + '" alt="' + alt + '"' + title + '>';
        } else {
          html += '<span class="md-unsafe-link" title="已拦截不安全的图片地址">[' + escapeHtml(node.alt || 'image') + ']</span>';
        }
        break;
      }
      case 'hardbreak':
        html += '<br>\n';
        break;
      case 'softbreak':
        html += '\n';
        break;
      default:
        // 理论上不会出现；兜底保证不抛异常
        html += escapeHtml(node.value ?? '');
    }
  }
  return html;
}

function renderInlineText(text) {
  return renderInlineNodes(parseInline(text));
}

function renderBlocks(blocks, tightList) {
  let html = '';
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        html += '<h' + block.level + '>' + renderInlineText(block.text) + '</h' + block.level + '>\n';
        break;
      case 'paragraph':
        if (tightList) {
          // 紧凑列表项内的段落不包 <p>，直接输出行内内容
          html += renderInlineText(block.text) + '\n';
        } else {
          html += '<p>' + renderInlineText(block.text) + '</p>\n';
        }
        break;
      case 'codeBlock': {
        const label = block.lang
          ? '<div class="md-code-lang">' + escapeHtml(block.lang) + '</div>\n'
          : '';
        html += '<figure class="md-code-block">\n' + label +
          '<pre><code' + (block.lang ? ' data-lang="' + escapeAttr(block.lang) + '"' : '') + '>' +
          escapeHtml(block.value) + '</code></pre>\n</figure>\n';
        break;
      }
      case 'blockquote':
        html += '<blockquote>\n' + renderBlocks(block.children, false) + '</blockquote>\n';
        break;
      case 'hr':
        html += '<hr>\n';
        break;
      case 'list':
        html += renderList(block);
        break;
      case 'listItem':
        // listItem 只在 list 上下文中渲染，这里兜底
        html += '<li>' + renderBlocks(block.children, false) + '</li>\n';
        break;
      case 'table':
        html += renderTable(block);
        break;
      default:
        html += '<!-- 未知块类型 -->\n';
    }
  }
  return html;
}

function renderList(list) {
  const tag = list.ordered ? 'ol' : 'ul';
  const startAttr = list.ordered && list.start !== 1 ? ' start="' + list.start + '"' : '';
  let html = '<' + tag + startAttr + '>\n';
  for (const item of list.items) {
    html += '<li>' + renderBlocks(item.children, !list.loose) + '</li>\n';
  }
  html += '</' + tag + '>\n';
  return html;
}

function renderTable(table) {
  let html = '<table>\n<thead>\n<tr>\n';
  table.header.forEach((cell, index) => {
    const align = table.aligns[index];
    const attr = align ? ' style="text-align:' + align + '"' : '';
    html += '<th' + attr + '>' + renderInlineText(cell) + '</th>\n';
  });
  html += '</tr>\n</thead>\n<tbody>\n';
  for (const row of table.rows) {
    html += '<tr>\n';
    row.forEach((cell, index) => {
      const align = table.aligns[index];
      const attr = align ? ' style="text-align:' + align + '"' : '';
      html += '<td' + attr + '>' + renderInlineText(cell) + '</td>\n';
    });
    html += '</tr>\n';
  }
  html += '</tbody>\n</table>\n';
  return html;
}

/**
 * 文档级渲染入口。
 * @param {{type:'document',children:Array}} ast
 * @returns {string} HTML 字符串
 */
export function renderDocument(ast) {
  try {
    return '<div class="markdown-body">\n' + renderBlocks(ast.children || [], false) + '</div>\n';
  } catch (error) {
    // 兜底：任何意外都不允许导致页面崩溃
    return '<div class="md-render-error">渲染过程中出现异常：' +
      escapeHtml(error && error.message ? error.message : String(error)) + '</div>';
  }
}
