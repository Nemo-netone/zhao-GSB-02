// src/main.js
// 应用入口：等待 DOM 就绪后启动 UI。

import { initUI } from './ui.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}
