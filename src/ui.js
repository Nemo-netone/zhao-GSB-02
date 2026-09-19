// ============================================================
// UI 模块：DOM 交互、内置示例、复制、清空、测试结果渲染
// ============================================================

/** 内置示例（用行数组拼接，避免反引号转义困扰） */
export const EXAMPLES = [
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
export function getElements() {
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
export function showToast(el, message, isError) {
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.toggle('toast-error', !!isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2000);
}

/** 复制文本到剪贴板（file:// 环境下 clipboard API 可能不可用，自动降级 execCommand） */
export async function copyText(text) {
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
export function renderTestResults(els, results) {
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