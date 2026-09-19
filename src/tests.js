// ============================================================
// 内置测试套件：28 条断言
// 每条断言给定 Markdown 输入，校验生成 HTML 的关键结构
// check 返回 true 表示通过，返回字符串表示失败原因（会被展示，绝不静默吞掉）
// ============================================================

import { parseBlocks } from './block-parser.js';
import { render } from './renderer.js';

/** Markdown -> HTML */
function toHtml(src) {
  return render(parseBlocks(src));
}

/** 用 DOMParser 做结构化查询 */
function query(html, selector) {
  return new DOMParser().parseFromString(html, 'text/html').querySelector(selector);
}

function queryAll(html, selector) {
  return new DOMParser().parseFromString(html, 'text/html').querySelectorAll(selector);
}

/** 组装失败详情（附带实际 HTML，截断展示） */
function fail(msg, html) {
  const snippet = html.length > 300 ? html.slice(0, 300) + ' ...' : html;
  return msg + '\n实际 HTML：' + snippet;
}

const tests = [
  // ---------- 标题 ----------
  {
    name: '一级标题渲染为 <h1>',
    input: '# 你好世界',
    check: (h) => h.includes('<h1>你好世界</h1>') || fail('未生成 <h1>你好世界</h1>', h),
  },
  {
    name: '六级标题渲染为 <h6>',
    input: '###### 最深的标题',
    check: (h) => h.includes('<h6>最深的标题</h6>') || fail('未生成 <h6>', h),
  },
  {
    name: '# 后无空格不视为标题',
    input: '#这不是标题',
    check: (h) => (h.includes('<p>#这不是标题</p>') && !h.includes('<h1')) || fail('应原样输出为段落', h),
  },

  // ---------- 段落与换行 ----------
  {
    name: '空行分隔为两个段落',
    input: '第一段\n\n第二段',
    check: (h) => queryAll(h, 'p').length === 2 || fail('应生成 2 个 <p>', h),
  },
  {
    name: '行尾两个空格产生 <br> 强制换行',
    input: '第一行  \n第二行',
    check: (h) => h.includes('<br>') || fail('未生成 <br>', h),
  },

  // ---------- 强调 ----------
  {
    name: '*斜体* 渲染为 <em>',
    input: '这是 *斜体* 文字',
    check: (h) => h.includes('<em>斜体</em>') || fail('未生成 <em>', h),
  },
  {
    name: '**粗体** 渲染为 <strong>',
    input: '这是 **粗体** 文字',
    check: (h) => h.includes('<strong>粗体</strong>') || fail('未生成 <strong>', h),
  },
  {
    name: '***粗斜体*** 渲染为嵌套 <strong><em>',
    input: '***粗斜体***',
    check: (h) => h.includes('<strong><em>粗斜体</em></strong>') || fail('未生成粗斜体嵌套标签', h),
  },
  {
    name: '~~删除线~~ 渲染为 <del>',
    input: '~~已删除~~',
    check: (h) => h.includes('<del>已删除</del>') || fail('未生成 <del>', h),
  },
  {
    name: '行内代码中的 * 不解析为斜体',
    input: '代码 `*a*` 结束',
    check: (h) => (h.includes('<code>*a*</code>') && !h.includes('<em>')) || fail('行内代码内容被错误解析', h),
  },

  // ---------- 链接与图片 ----------
  {
    name: '链接渲染为 <a href>',
    input: '[百度](https://www.baidu.com)',
    check: (h) => h.includes('<a href="https://www.baidu.com">百度</a>') || fail('链接渲染错误', h),
  },
  {
    name: 'javascript: 协议被过滤',
    input: '[点我](javascript:alert(1))',
    check: (h) => (!h.includes('<a ') && !h.includes('href="javascript:')) || fail('危险协议未被过滤', h),
  },
  {
    name: '图片渲染为 <img>',
    input: '![图标](icon.png)',
    check: (h) => h.includes('<img src="icon.png" alt="图标">') || fail('图片渲染错误', h),
  },

  // ---------- 列表 ----------
  {
    name: '无序列表生成 <ul><li>',
    input: '- 苹果\n- 香蕉',
    check: (h) => queryAll(h, 'ul > li').length === 2 || fail('无序列表项数量错误', h),
  },
  {
    name: '有序列表生成 <ol><li>',
    input: '1. 第一步\n2. 第二步',
    check: (h) => queryAll(h, 'ol > li').length === 2 || fail('有序列表项数量错误', h),
  },
  {
    name: '列表支持三层嵌套（ul ul ul）',
    input: '- 一层\n  - 二层\n    - 三层',
    check: (h) => {
      const deepest = query(h, 'ul ul ul li');
      return (deepest && deepest.textContent.includes('三层')) || fail('三层嵌套结构缺失', h);
    },
  },
  {
    name: '无序列表中可嵌套有序列表',
    input: '- 水果\n  1. 苹果\n  2. 香蕉',
    check: (h) => queryAll(h, 'ul ol > li').length === 2 || fail('混合嵌套列表结构错误', h),
  },
  {
    name: '列表项可包含多段落',
    input: '- 第一段\n\n  第二段',
    check: (h) => queryAll(h, 'li > p').length === 2 || fail('列表项内应包含 2 个段落', h),
  },

  // ---------- 代码块 ----------
  {
    name: '代码块内的 Markdown 语法不被解析',
    input: ['```', '*不是斜体* # 不是标题 `code`', '```'].join('\n'),
    check: (h) => {
      const code = query(h, 'pre code');
      return (code && code.textContent.includes('*不是斜体* # 不是标题 `code`') && !h.includes('<em>') && !h.includes('<h1'))
        || fail('代码块内容被错误解析', h);
    },
  },
  {
    name: '代码块语言标注生成 language- 类名与标签',
    input: ['```js', 'console.log(1)', '```'].join('\n'),
    check: (h) => (h.includes('class="language-js"') && h.includes('>js</span>')) || fail('语言标注缺失', h),
  },

  // ---------- 引用块 ----------
  {
    name: '引用块渲染为 <blockquote>',
    input: '> 这是一段引用',
    check: (h) => {
      const bq = query(h, 'blockquote p');
      return (bq && bq.textContent.includes('这是一段引用')) || fail('引用块渲染错误', h);
    },
  },
  {
    name: '>> 嵌套引用生成嵌套 blockquote',
    input: '> 外层\n> > 内层',
    check: (h) => {
      const inner = query(h, 'blockquote blockquote');
      return (inner && inner.textContent.includes('内层')) || fail('嵌套引用结构缺失', h);
    },
  },
  {
    name: '引用块内可包含列表',
    input: '> - 甲\n> - 乙',
    check: (h) => queryAll(h, 'blockquote ul > li').length === 2 || fail('引用内列表结构错误', h),
  },

  // ---------- 表格 ----------
  {
    name: '表格生成 <table> 且列数正确',
    input: '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |',
    check: (h) => (queryAll(h, 'th').length === 2 && queryAll(h, 'tbody td').length === 2) || fail('表格列数错误', h),
  },
  {
    name: '表格支持 :--- 对齐方式',
    input: '| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| a | b | c |',
    check: (h) => (h.includes('text-align:left') && h.includes('text-align:center') && h.includes('text-align:right'))
      || fail('对齐样式缺失', h),
  },

  // ---------- 水平线 ----------
  {
    name: '--- 渲染为 <hr>',
    input: '上文\n\n---\n\n下文',
    check: (h) => h.includes('<hr>') || fail('未生成 <hr>', h),
  },
  {
    name: '*** 与 ___ 也渲染为 <hr>',
    input: '***\n\n___',
    check: (h) => queryAll(h, 'hr').length === 2 || fail('*** 或 ___ 未生成 <hr>', h),
  },

  // ---------- 转义 ----------
  {
    name: '\\* 转义后按普通文本输出',
    input: '\\*这不是斜体\\*',
    check: (h) => (h.includes('*这不是斜体*') && !h.includes('<em>')) || fail('转义字符被错误解析', h),
  },
  {
    name: '\\` 转义后不生成行内代码',
    input: '\\`不是代码\\`',
    check: (h) => (h.includes('`不是代码`') && !h.includes('<code>')) || fail('反引号转义失效', h),
  },

  // ---------- 健壮性 ----------
  {
    name: '未闭合的 ** 按普通文本输出',
    input: '**没有闭合',
    check: (h) => (h.includes('**没有闭合') && !h.includes('<strong>')) || fail('未闭合强调应原样输出', h),
  },
  {
    name: '未闭合的代码围栏不崩溃',
    input: ['```js', 'let a = 1'].join('\n'),
    check: (h) => h.includes('let a = 1') || fail('未闭合代码围栏处理失败', h),
  },
  {
    name: '各种非法输入均不抛异常',
    input: '[broken](\n\n![alt\n\n`\n\n|\n\n***\n\n> ',
    check: (h) => typeof h === 'string' || fail('解析过程抛异常', h),
  },
  {
    name: '空输入返回空字符串',
    input: '',
    check: (h) => h === '' || fail('空输入应输出空字符串', h),
  },
];

/**
 * 运行全部断言，返回 [{ name, pass, detail }]
 * 单条断言抛异常会被捕获并记为失败，不影响其他断言
 */
export function runTests() {
  return tests.map((t) => {
    try {
      const html = toHtml(t.input);
      const result = t.check(html);
      return { name: t.name, pass: result === true, detail: result === true ? '' : String(result) };
    } catch (err) {
      return { name: t.name, pass: false, detail: '断言执行抛出异常：' + (err && err.message) };
    }
  });
}

/** 断言总数（供 UI 展示） */
export const TEST_COUNT = tests.length;