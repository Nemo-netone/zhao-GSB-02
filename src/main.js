// ============================================================
// 入口：装配解析管线与 UI 事件
// 数据流：textarea 输入 -> 300ms 防抖 -> parseBlocks -> render -> 预览区
// ============================================================

import { parseBlocks } from './block-parser.js';
import { render } from './renderer.js';
import { runTests } from './tests.js';
import {
  EXAMPLES,
  getElements,
  showToast,
  copyText,
  renderTestResults,
} from './ui.js';

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