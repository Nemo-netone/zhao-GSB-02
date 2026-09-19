// src/inline-parser.js
// 行内解析器：把段落级纯文本解析为行内 AST。
// 核心优先级：转义字符 -> 行内代码 -> 图片 -> 链接 -> 强调（粗体/斜体/删除线）。
// 本模块只负责结构，所有文本的 HTML 转义统一交给 renderer，避免双重转义。

// 块级阶段用该私有符号标记“行尾两空格”产生的强制换行
export const HARD_BREAK = '\u0000';

// 允许反斜杠转义的字符（覆盖题目要求并兼容 CommonMark 常见集合）
const ESCAPABLE = new Set(['\\', '`', '*', '_', '{', '}', '[', ']',
  '(', ')', '#', '+', '-', '.', '!', '|', '>', '~', '"', "'", '/']);

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === HARD_BREAK;
}

function isAlphanumeric(ch) {
  if (!ch) return false;
  const code = ch.codePointAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

// Unicode 风格的“标点”判定：非空白且非字母数字即视为标点
function isPunctuation(ch) {
  return !!ch && !isWhitespace(ch) && !isAlphanumeric(ch);
}

/**
 * 解析行内代码。start 指向起始反引号。
 * 闭合规则：寻找长度“恰好相等”的反引号串（CommonMark 行为的简化版）。
 * 返回 { node, next }，找不到合法闭合时返回 null（反引号按普通文本处理）。
 */
function parseCodeSpan(src, start) {
  let tickCount = 0;
  while (start + tickCount < src.length && src[start + tickCount] === '`') tickCount++;

  let search = start + tickCount;
  let closeStart = -1;
  while (search < src.length) {
    const idx = src.indexOf('`', search);
    if (idx === -1) break;
    let runLength = 0;
    while (idx + runLength < src.length && src[idx + runLength] === '`') runLength++;
    if (runLength === tickCount) {
      closeStart = idx;
      break;
    }
    search = idx + runLength;
  }
  if (closeStart === -1) return null;

  let content = src.slice(start + tickCount, closeStart);
  // 内容首尾各恰有一个空格、且整体不全是空白时，剔除这两个空格
  if (content.length >= 2 && content[0] === ' ' &&
      content[content.length - 1] === ' ' && content.trim() !== '') {
    content = content.slice(1, -1);
  }
  // 代码 span 内的换行规范化为空格
  content = content.replace(/\r?\n/g, ' ');

  return { node: { type: 'code', value: content }, next: closeStart + tickCount };
}

/**
 * 从 openIdx（指向 '['）开始寻找匹配的 ']'，支持嵌套与反斜杠转义，
 * 跨越行内代码时不把代码内部的括号计入。
 */
function findMatchingBracket(src, openIdx) {
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      const codeSpan = parseCodeSpan(src, i);
      if (codeSpan) {
        i = codeSpan.next;
        continue;
      }
    }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * 解析链接目标部分： ( url "title" )
 * start 指向 '('。返回 { url, title, next } 或 null。
 */
function parseLinkDestination(src, start) {
  let i = start + 1;
  while (i < src.length && isWhitespace(src[i]) && src[i] !== HARD_BREAK) i++;

  let url = '';
  if (src[i] === '<') {
    const end = src.indexOf('>', i + 1);
    if (end === -1) return null;
    // 尖括号内的反斜杠转义解开
    url = src.slice(i + 1, end).replace(/\\(.)/g, '$1');
    i = end + 1;
  } else {
    const begin = i;
    let parenDepth = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (isWhitespace(ch)) break;
      if (ch === '(') parenDepth++;
      if (ch === ')') {
        if (parenDepth === 0) break;
        parenDepth--;
      }
      i++;
    }
    url = src.slice(begin, i);
  }

  // 可选的 title：必须与 url 之间至少有空白
  let title = null;
  const beforeSpace = i;
  while (i < src.length && src[i] === ' ') i++;
  const quote = src[i];
  if (i > beforeSpace && (quote === '"' || quote === "'")) {
    let j = i + 1;
    let value = '';
    let closed = false;
    while (j < src.length) {
      if (src[j] === quote) { closed = true; break; }
      if (src[j] === '\\') { value += src[j + 1] ?? ''; j += 2; continue; }
      value += src[j];
      j++;
    }
    if (closed) {
      title = value;
      i = j + 1;
      while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++;
    }
  }

  if (src[i] !== ')') return null;
  return { url: url.trim(), title, next: i + 1 };
}

/**
 * 行内解析主入口。
 * 使用分隔符栈处理强调：开界符先以 delim 节点占位入栈，
 * 命中闭界符时再把两个界符之间的节点包裹成 em/strong/strike。
 * 未匹配的界符在收尾阶段还原为普通文本。
 */
export function parseInline(source) {
  const src = String(source ?? '');
  const nodes = [];
  let textBuffer = '';
  const openers = []; // { char, count, nodeIndex }

  const flushText = () => {
    if (textBuffer !== '') {
      nodes.push({ type: 'text', value: textBuffer });
      textBuffer = '';
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // 强制换行标记（块级阶段注入）
    if (ch === HARD_BREAK) {
      flushText();
      nodes.push({ type: 'hardbreak' });
      i++;
      continue;
    }
    if (ch === '\n') {
      flushText();
      nodes.push({ type: 'softbreak' });
      i++;
      continue;
    }

    // 反斜杠转义
    if (ch === '\\') {
      const next = src[i + 1];
      if (next && ESCAPABLE.has(next)) {
        textBuffer += next;
        i += 2;
        continue;
      }
      if (next === '\n' || next === HARD_BREAK) {
        flushText();
        nodes.push({ type: 'hardbreak' });
        i += 2;
        continue;
      }
      textBuffer += ch;
      i++;
      continue;
    }

    // 行内代码：优先级最高，内部不做任何解析
    if (ch === '`') {
      const codeSpan = parseCodeSpan(src, i);
      if (codeSpan) {
        flushText();
        nodes.push(codeSpan.node);
        i = codeSpan.next;
        continue;
      }
      textBuffer += ch;
      i++;
      continue;
    }

    // 图片 ![alt](url)
    if (ch === '!' && src[i + 1] === '[') {
      const close = findMatchingBracket(src, i + 1);
      if (close !== -1 && src[close + 1] === '(') {
        const dest = parseLinkDestination(src, close + 1);
        if (dest) {
          flushText();
          nodes.push({
            type: 'image',
            url: dest.url,
            title: dest.title,
            alt: src.slice(i + 2, close).replace(/\\(.)/g, '$1')
          });
          i = dest.next;
          continue;
        }
      }
    }

    // 链接 [text](url)
    if (ch === '[') {
      const close = findMatchingBracket(src, i);
      if (close !== -1 && src[close + 1] === '(') {
        const dest = parseLinkDestination(src, close + 1);
        if (dest) {
          flushText();
          const label = src.slice(i + 1, close);
          nodes.push({
            type: 'link',
            url: dest.url,
            title: dest.title,
            children: parseInline(label)
          });
          i = dest.next;
          continue;
        }
      }
    }

    // 强调分隔符：*  _  ~
    if (ch === '*' || ch === '_' || ch === '~') {
      let count = 0;
      while (i + count < src.length && src[i + count] === ch) count++;

      // 删除线只接受恰好两个 ~
      if (ch === '~' && count !== 2) {
        textBuffer += '~'.repeat(count);
        i += count;
        continue;
      }

      const before = src[i - 1];
      const after = src[i + count];

      // CommonMark 左右侧翼判定；边界（before/after 为空）不参与标点条件
      const afterPunc = isPunctuation(after);
      const beforePunc = isPunctuation(before);
      const leftFlanking = !!after && !isWhitespace(after) &&
        (!afterPunc || !before || isWhitespace(before) || beforePunc);
      const rightFlanking = !!before && !isWhitespace(before) &&
        (!beforePunc || !after || isWhitespace(after) || afterPunc);

      let canOpen = leftFlanking;
      let canClose = rightFlanking;
      if (ch === '_') {
        // 下划线有更严格的单词内限制
        canOpen = leftFlanking && (!rightFlanking || beforePunc);
        canClose = rightFlanking && (!leftFlanking || afterPunc);
      }

      if (canClose) {
        // 在栈中自顶向下寻找同字符的开界符
        let openerIndex = -1;
        for (let k = openers.length - 1; k >= 0; k--) {
          if (openers[k].char === ch) { openerIndex = k; break; }
        }
        if (openerIndex !== -1) {
          const opener = openers[openerIndex];
          flushText();
          const inner = nodes.splice(opener.nodeIndex + 1);
          nodes.pop(); // 移除开界符占位节点
          const useCount = Math.min(opener.count, count);
          const type = ch === '~' ? 'strike'
            : useCount >= 3 ? 'strongEm'
            : useCount === 2 ? 'strong' : 'em';
          nodes.push({ type, children: inner });
          openers.length = openerIndex; // 上方的栈条目已被包入子节点
          i += useCount;
          count -= useCount;
          canClose = false;
          // 剩余的界符若能开界，则作为新的开界符继续
          if (count > 0 && leftFlanking) {
            flushText();
            const pos = nodes.length;
            nodes.push({ type: 'delim', value: ch.repeat(count) });
            openers.push({ char: ch, count, nodeIndex: pos });
            i += count;
            continue;
          }
          if (count > 0) {
            textBuffer += ch.repeat(count);
            i += count;
            continue;
          }
          continue;
        }
      }

      if (canOpen) {
        flushText();
        const pos = nodes.length;
        nodes.push({ type: 'delim', value: ch.repeat(count) });
        openers.push({ char: ch, count, nodeIndex: pos });
        i += count;
        continue;
      }

      // 既不能开也不能闭：原样输出
      textBuffer += ch.repeat(count);
      i += count;
      continue;
    }

    textBuffer += ch;
    i++;
  }

  flushText();
  finalizeDelimiters(nodes);
  return nodes;
}

// 把所有未闭合的界符节点还原为普通文本（链接子树由各自的 parseInline 收尾）
function finalizeDelimiters(nodes) {
  for (let k = 0; k < nodes.length; k++) {
    const node = nodes[k];
    if (node.type === 'delim') {
      nodes[k] = { type: 'text', value: node.value };
    }
    if (node.children) finalizeDelimiters(node.children);
  }
}


