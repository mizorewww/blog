// @ts-check

export const readingFixtureImage =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1200 420%22%3E%3Crect width=%221200%22 height=%22420%22 fill=%22%23dbeafe%22/%3E%3Cpath d=%22M0 300 C240 210 360 330 600 250 C820 176 970 220 1200 120 L1200 420 L0 420 Z%22 fill=%22%230ea5e9%22 opacity=%22.32%22/%3E%3Ccircle cx=%22940%22 cy=%22115%22 r=%2276%22 fill=%22%23f8fafc%22 opacity=%22.72%22/%3E%3C/svg%3E'

export const readingFixtureHtml = `
  <h2 class="content-header" id="reading-fixture-h2"><a href="#reading-fixture-h2"><span class="content-header-link">#</span></a>Fixture h2 with <code>inline_dark_code</code> and <mark>marked text</mark></h2>
  <p>这是一个测试段落，包含 <strong>strong</strong>、<em>emphasis</em>、<del>deleted</del>、<a href="#reading-fixture-table">table link</a>、<abbr title="Accessible Rich Internet Applications">ARIA</abbr>、<kbd>⌘</kbd><kbd>K</kbd>、H<sub>2</sub>O、x<sup>2</sup>、脚注引用 <sup id="reading-fixture-ref"><a href="#reading-fixture-footnote">1</a></sup> 和一个非常长的 token: supercalifragilisticexpialidocious-supercalifragilisticexpialidocious-260804。</p>
  <h3 class="content-header" id="reading-fixture-lists"><a href="#reading-fixture-lists"><span class="content-header-link">#</span></a>Nested lists and task list</h3>
  <ul class="contains-task-list">
    <li>一级项目<ul><li>二级项目 with a <a href="#reading-fixture-h2"><code>link_code</code></a></li></ul></li>
    <li class="task-list-item"><input type="checkbox" checked disabled>已完成任务</li>
    <li class="task-list-item"><input type="checkbox" disabled>未完成任务</li>
  </ul>
  <ol><li>Ordered item one</li><li>Ordered item two</li></ol>
  <blockquote><p>“引用块里也应该有舒适的行高、足够的边界和暗色对比。”</p></blockquote>
  <details><summary>展开阅读细节</summary><p>Details content keeps the same editorial rhythm without browser-default marker noise.</p></details>
  <h4 class="content-header" id="reading-fixture-h4"><a href="#reading-fixture-h4"><span class="content-header-link">#</span></a>Fixture h4</h4>
  <h5>Fixture h5</h5>
  <h6>Fixture h6</h6>
  <figure class="article-figure"><img class="article-image" src="${readingFixtureImage}" alt="Abstract reading fixture surface"><figcaption>Figure caption for the injected reading fixture.</figcaption></figure>
  <div class="article-table-scroll" id="reading-fixture-table"><table><thead><tr><th>Part</th><th>Role</th><th>Note</th></tr></thead><tbody><tr><td>Inline code</td><td>Semantic token</td><td>Dark and light contrast measured.</td></tr><tr><td>Tables</td><td>2D content</td><td>Scroll inside their own container.</td></tr></tbody></table></div>
  <pre><code>const readingMax = true
console.log(readingMax)</code></pre>
  <div class="article-data-block not-prose" data-reading-fixture-embed><p>Embedded client block keeps its own layout.</p></div>
  <hr>
  <section class="footnotes"><ol><li id="reading-fixture-footnote">Footnote content with back reference <a class="data-footnote-backref" href="#reading-fixture-h2">↩︎</a></li></ol></section>
  <p>Tail token: https://example.com/really/long/path/that/should/not/escape/the/article/column/260804260804260804260804260804</p>
`
