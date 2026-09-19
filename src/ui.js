// src/ui.js
// 界面逻辑：实时渲染（300ms 防抖）、耗时统计、示例加载、
// 复制 HTML、清空、运行测试并逐条展示结果。

import { parseBlocks } from './block-parser.js';
import { renderDocument } from './renderer.js';
import { runTests } from './tests.js';

// 三个内置示例
export const SAMPLES = {
  full: {
    label: '完整语法示例',
    text: [
      '# Markdown 渲染器演示',
      '',
      '## 强调语法',
      '这是 *斜体*、**粗体**、***粗斜体***、~~删除线~~ 与 `行内代码`。',
      '',
      '## 链接与图片',
      '这是一个[链接](https://example.com "标题")，图片：![占位图](https://example.com/a.png)。',
      '危险链接会被拦截：[bad](javascript:alert(1))。',
      '',
      '## 列表',
      '- 无序项一',
      '- 无序项二',
      '  1. 嵌套有序 A',
      '  2. 嵌套有序 B',
      '- 无序项三',
      '',
      '## 引用',
      '> 外层引用',
      '>',
      '> > 内层引用，含 **粗体**',
      '',
      '## 代码块',
      '```js',
      'function add(a, b) {',
      '  // # 这一行在代码块里，不会被解析成标题',
      '  return a + b;',
      '}',

      '```',
      '',
      '## 表格',
      '| 左对齐 | 居中 | 右对齐 |',
      '| :--- | :---: | ---: |',
      '| 1 | 2 | 3 |',
      '| 4 | 5 | 6 |',
      '',
      '## 水平线',
      '上面是普通文本。',
      '',
      '---',
      '',
      '下面是水平线之后的内容。',
      '',
      '## 换行',
      '第一行（行尾两个空格）  ',
      '第二行'
    ].join('\n')
  },
  nested: {
    label: '嵌套列表与引用示例',
    text: [
      '# 嵌套列表',
      '',
      '1. 第一层 1',
      '   1. 第二层 1.1',
      '      - 第三层 A',
      '        - 第四层 A-1',
      '      - 第三层 B',
      '   2. 第二层 1.2',
      '2. 第一层 2',
      '',
      '## 2 空格缩进',
      '',
      '- 水果',
      '  - 苹果',
      '    - 红富士',
      '  - 香蕉',
      '- 蔬菜',
      '',
      '## 列表项中的多段落',
      '',
      '- 这是列表项的第一段。',
      '',
      '  这是同一项的第二段，说明列表项可以包含多段落内容。',
      '',
      '  - 列表项中还可以嵌套列表',
      '',
      '# 嵌套引用',
      '',
      '> 一级引用',
      '> > 二级引用',
      '> > > 三级引用，包含 `代码` 与 *斜体*',
      '>',
      '> 回到一级，下面是引用中的列表：',
      '>',
      '> - 第一项',
      '> - 第二项',
      '>   1. 嵌套有序',
      '>   2. 再来一项'
    ].join('\n')
  },
  escape: {
    label: '转义与代码块示例',
    text: [
      '# 转义与代码块',
      '',
      '## 反斜杠转义',
      '',
      '\\* 这不是斜体 \\*',
      '\\` 这不是行内代码 \\`',
      '\\# 这不是标题',
      'a\\*b\\_c\\[d\\]\\(e\\)',
      '',
      '## 行内代码的最高优先级',
      '',
      '`*不是斜体*`、`**不是粗体**`、`[不是链接](x)`',
      '',
      '## 代码块原样输出',
      '',
      '```',
      '# 井号原样',
      '*星号原样*',
      '`反引号原样`',
      '[链接语法原样](url)',
      '   缩进也保留',
      '```',
      '',
      '```python',
      '# Python 示例（语言仅做标签展示）',
      'def hello():',
      '    print("*hi* #")',
      '```',
      '',
      '## 边界输入',
      '',
      '未闭合的代码围栏也不会崩溃，未闭合的 *强调 按文本输出。',
      '',
      '```',
      '未闭合围栏内容'
    ].join('\n')
  }
};

const DEBOUNCE_MS = 300;

function debounce(fn, wait) {
  let timer = null;
  return function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // file:// 等环境下 clipboard API 可能不可用：使用 textarea + execCommand 兜底
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      document.body.removeChild(textarea);
    }
  });
}

export function initUI() {
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const timing = document.getElementById('timing');
  const sampleSelect = document.getElementById('sampleSelect');
  const loadSampleBtn = document.getElementById('loadSampleBtn');
  const copyHtmlBtn = document.getElementById('copyHtmlBtn');
  const clearBtn = document.getElementById('clearBtn');
  const runTestsBtn = document.getElementById('runTestsBtn');
  const testPanel = document.getElementById('testPanel');
  const testSummary = document.getElementById('testSummary');
  const testList = document.getElementById('testList');

  // 填充示例下拉框
  Object.entries(SAMPLES).forEach(([key, sample]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = sample.label;
    sampleSelect.appendChild(option);
  });

  function renderNow() {
    const source = editor.value;
    const start = performance.now();
    let html;
    try {
      const ast = parseBlocks(source);
      html = renderDocument(ast);
    } catch (error) {
      html = '<div class="md-render-error">解析异常：' +
        String(error && error.message ? error.message : error) + '</div>';
    }
    const cost = performance.now() - start;
    preview.innerHTML = html;
    timing.textContent = '解析耗时：' + cost.toFixed(2) + ' ms';
  }

  const scheduleRender = debounce(renderNow, DEBOUNCE_MS);

  editor.addEventListener('input', scheduleRender);

  loadSampleBtn.addEventListener('click', () => {
    const key = sampleSelect.value;
    const sample = SAMPLES[key];
    if (!sample) return;
    editor.value = sample.text;
    renderNow();
  });

  copyHtmlBtn.addEventListener('click', async () => {
    const oldText = copyHtmlBtn.textContent;
    try {
      await copyText(preview.innerHTML);
      copyHtmlBtn.textContent = '已复制 ✓';
    } catch {
      copyHtmlBtn.textContent = '复制失败';
    }
    setTimeout(() => { copyHtmlBtn.textContent = oldText; }, 1500);
  });

  clearBtn.addEventListener('click', () => {
    editor.value = '';
    renderNow();
    editor.focus();
  });

  runTestsBtn.addEventListener('click', () => {
    const report = runTests();
    testPanel.hidden = false;
    testSummary.innerHTML =
      '共 <strong>' + report.total + '</strong> 条，' +
      '通过 <strong class="test-pass-count">' + report.passed + '</strong> 条，' +
      '失败 <strong class="test-fail-count">' + report.failed + '</strong> 条';
    testSummary.className = report.failed === 0 ? 'test-summary pass' : 'test-summary fail';

    testList.innerHTML = '';
    report.results.forEach((result) => {
      const item = document.createElement('details');
      item.className = 'test-case ' + (result.passed ? 'pass' : 'fail');
      const summary = document.createElement('summary');
      summary.textContent = (result.passed ? '✓ ' : '✗ ') + result.name;
      item.appendChild(summary);
      if (!result.passed) {
        const detail = document.createElement('pre');
        detail.className = 'test-detail';
        detail.textContent = result.detail;
        item.appendChild(detail);
      }
      testList.appendChild(item);
    });
  });

  // 默认加载完整示例并首次渲染
  editor.value = SAMPLES.full.text;
  renderNow();
}
