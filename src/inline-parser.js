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
export function escapeHtml(s) {
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
export function parseInline(text) {
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