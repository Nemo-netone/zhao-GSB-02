// src/tests.js
// 内置自测：给定 Markdown -> 渲染 HTML，对关键结构做断言。
// 不依赖任何测试框架；runTests 可在浏览器与 Node 中直接运行。

import { parseBlocks } from './block-parser.js';
import { parseInline } from './inline-parser.js';
import { renderDocument } from './renderer.js';

function render(markdown) {
  return renderDocument(parseBlocks(markdown));
}

// 统计字符串中某个子串出现次数
function countOccurrences(haystack, needle) {
  if (needle === '') return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

// 用栈校验标签嵌套深度是否达到期望值
function maxNestingDepth(html, tag) {
  const open = new RegExp('<' + tag + '(\\s|>)', 'g');
  const close = new RegExp('</' + tag + '>', 'g');
  let depth = 0;
  let max = 0;
  let cursor = 0;
  const tokens = [];
  let match;
  while ((match = open.exec(html))) tokens.push({ index: match.index, kind: 'open' });
  while ((match = close.exec(html))) tokens.push({ index: match.index, kind: 'close' });
  tokens.sort((a, b) => a.index - b.index);
  for (const token of tokens) {
    if (token.kind === 'open') { depth++; max = Math.max(max, depth); }
    else depth--;
    cursor++;
  }
  return max;
}

export function runTests() {
  const cases = [
    {
      name: '1. 六级标题全部渲染',
      check: (html) =>
        html.includes('<h1>H1</h1>') &&
        html.includes('<h2>H2</h2>') &&
        html.includes('<h3>H3</h3>') &&
        html.includes('<h4>H4</h4>') &&
        html.includes('<h5>H5</h5>') &&
        html.includes('<h6>H6</h6>'),
      input: '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6'
    },
    {
      name: '2. 空行分段',
      check: (html) => countOccurrences(html, '<p>') === 2,
      input: '第一段\n\n第二段'
    },
    {
      name: '3. 行尾两空格为强制换行 <br>',
      check: (html) => html.includes('第一行<br>') && html.includes('第二行'),
      input: '第一行  \n第二行'
    },
    {
      name: '4. 斜体 *text*',
      check: (html) => html.includes('<em>斜体</em>'),
      input: '*斜体*'
    },
    {
      name: '5. 粗体 **text**',
      check: (html) => html.includes('<strong>粗体</strong>'),
      input: '**粗体**'
    },
    {
      name: '6. 粗斜体 ***text***',
      check: (html) => html.includes('<strong><em>粗斜体</em></strong>'),
      input: '***粗斜体***'
    },
    {
      name: '7. 删除线 ~~text~~',
      check: (html) => html.includes('<del>删除</del>'),
      input: '~~删除~~'
    },
    {
      name: '8. 行内代码 <code>',
      check: (html) => html.includes('<code class="md-code-inline">var x = 1;</code>'),
      input: '`var x = 1;`'
    },
    {
      name: '9. 行内代码优先级最高（内部星号不变斜体）',
      check: (html) => html.includes('<code class="md-code-inline">*a*</code>') && !/<em>a<\/em>/.test(html),
      input: '`*a*`'
    },
    {
      name: '10. 普通链接',
      check: (html) => html.includes('<a href="https://example.com"') && html.includes('>示例</a>'),
      input: '[示例](https://example.com)'
    },
    {
      name: '11. 图片渲染 <img> 与 alt',
      check: (html) => html.includes('<img src="a.png" alt="图片说明">'),
      input: '![图片说明](a.png)'
    },
    {
      name: '12. javascript: 协议被过滤',
      check: (html) => !/href="javascript:/i.test(html) && html.includes('md-unsafe-link'),
      input: '[x](javascript:alert(1))'
    },
    {
      name: '13. 无序列表三种标记',
      check: (html) => {
        return /<li>a\s*<\/li>/.test(html) && /<li>b\s*<\/li>/.test(html) && /<li>c\s*<\/li>/.test(html);
      },
      input: '- a\n* b\n+ c'
    },
    {
      name: '14. 有序列表',
      check: (html) => html.includes('<ol>') && /<li>一\s*<\/li>/.test(html) && /<li>二\s*<\/li>/.test(html),
      input: '1. 一\n2. 二'
    },
    {
      name: '15. 嵌套列表至少 3 层（2 空格缩进）',
      check: (html) => maxNestingDepth(html, 'ul') >= 3,
      input: '- a\n  - b\n    - c'
    },
    {
      name: '16. 嵌套列表 4 空格缩进同样支持',
      check: (html) => maxNestingDepth(html, 'ul') >= 3,
      input: '- a\n    - b\n        - c'
    },
    {
      name: '17. 有序嵌套有序',
      check: (html) => maxNestingDepth(html, 'ol') >= 2,
      input: '1. a\n2. b\n   1. c\n   2. d\n3. e'
    },
    {
      name: '18. 列表项多段落内容',
      check: (html) => {
        const liSegment = html.slice(html.indexOf('<li>'), html.indexOf('</li>', html.indexOf('<li>') + 4) + 5);
        return liSegment.includes('<p>第一段</p>') && liSegment.includes('<p>第二段</p>');
      },
      input: '- 第一段\n\n  第二段'
    },
    {
      name: '19. 围栏代码块与语言标签',
      check: (html) => html.includes('data-lang="js"') && html.includes('md-code-lang') && html.includes('const a = 1;'),
      input: '```js\nconst a = 1;\n```'
    },
    {
      name: '20. 代码块内 Markdown 不被解析（* # ` 原样）',
      check: (html) => {
        const pre = html.slice(html.indexOf('<pre>'), html.indexOf('</pre>'));
        return pre.includes('*不是斜体*') && pre.includes('# 不是标题') &&
          pre.includes('`backtick`') && !pre.includes('<em>') && !pre.includes('<h1');
      },
      input: '```\n*不是斜体*\n# 不是标题\n`backtick`\n```'
    },
    {
      name: '21. 未闭合围栏不崩溃且原样输出',
      check: (html) => html.includes('<pre>') && html.includes('未闭合'),
      input: '```\n未闭合'
    },
    {
      name: '22. 引用块',
      check: (html) => html.includes('<blockquote>') && html.includes('引用内容'),
      input: '> 引用内容'
    },
    {
      name: '23. 嵌套引用 >>',
      check: (html) => maxNestingDepth(html, 'blockquote') >= 2,
      input: '> 外层\n>> 内层'
    },
    {
      name: '24. 引用块内包含列表',
      check: (html) => {
        const segment = html.slice(html.indexOf('<blockquote>'));
        return segment.includes('<ul>') && /<li>项\s*<\/li>/.test(segment);
      },
      input: '> - 项'
    },
    {
      name: '25. 表格表头/行数与列数',
      check: (html) => {
        return html.includes('<table>') &&
          (html.match(/<th[ >]/g) || []).length === 2 &&
          (html.match(/<tr>/g) || []).length === 3 &&
          countOccurrences(html, '<td>') === 4 &&
          html.includes('<td>1</td>') && html.includes('<td>2</td>');
      },
      input: '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
    },
    {
      name: '26. 表格对齐属性 :--- / ---: / :---: ',
      check: (html) => html.includes('text-align:left') &&
        html.includes('text-align:right') && html.includes('text-align:center'),
      input: '| L | R | C |\n| :--- | ---: | :---: |\n| 1 | 2 | 3 |'
    },
    {
      name: '27. 水平线三种写法',
      check: (html) => countOccurrences(html, '<hr>') === 3,
      input: '---\n\n***\n\n___'
    },
    {
      name: '28. 反斜杠转义按普通文本输出',
      check: (html) => html.includes('*普通*') && !html.includes('<em>普通</em>') &&
        html.includes('`code`') && html.includes('a|b'),
      input: '\\*普通*  \\`code`  a\\|b'
    },
    {
      name: '29. 非法/怪输入不抛异常',
      check: (html) => typeof html === 'string' && html.includes('markdown-body'),
      input: '###\n\n|\n\n[未闭合\n(无括号)\n\n***\n> \n- \n`单tick'
    },
    {
      name: '30. parseInline 对空值安全',
      check: () => {
        let ok = true;
        try { parseInline(undefined); parseInline(null); parseInline(''); } catch { ok = false; }
        return ok;
      },
      input: ''
    }
  ];

  const results = cases.map((testCase) => {
    let passed = false;
    let detail = '';
    let html = '';
    try {
      html = render(testCase.input);
      passed = !!testCase.check(html);
      if (!passed) detail = '断言返回 false。实际 HTML 片段：' + html.slice(0, 300);
    } catch (error) {
      passed = false;
      detail = '断言执行抛异常：' + (error && error.stack ? error.stack : String(error));
    }
    return { name: testCase.name, passed, detail, html };
  });

  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results
  };
}





