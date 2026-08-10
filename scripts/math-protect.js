/*!
 * math-protect.js
 *
 * 在 markdown 渲染前把 MathJax 公式（$$...$$、\(...\)、\[...\]、$...$）替换为占位符，
 * 渲染完成后再还原，避免 markdown 的转义/强调规则破坏 LaTeX 源码。
 * 该文件由 Hexo 自动从站点根 scripts/ 目录加载。
 */
'use strict';

const BLOCK_PREFIX = 'MATHJAX_BLOCK_';
const INLINE_PREFIX = 'MATHJAX_INLINE_';

hexo.extend.filter.register('before_post_render', function (data) {
  const store = {};
  let blockId = 0;
  let inlineId = 0;

  const save = (prefix, text) => {
    const token = `@@${prefix}${(prefix === BLOCK_PREFIX ? blockId++ : inlineId++)}@@`;
    store[token] = text;
    return token;
  };

  data.content = data.content
    // 块级公式 $$ ... $$
    .replace(/\$\$[\s\S]*?\$\$/g, (m) => save(BLOCK_PREFIX, m))
    // 行内公式 \( ... \) 与 \[ ... \]
    .replace(/\\\([\s\S]*?\\\)/g, (m) => save(INLINE_PREFIX, m))
    .replace(/\\\[[\s\S]*?\\\]/g, (m) => save(INLINE_PREFIX, m))
    // 行内公式 $ ... $（排除 $$）
    .replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (m) => save(INLINE_PREFIX, m));

  data._mathjaxStore = store;
  return data;
});

hexo.extend.filter.register('after_post_render', function (data) {
  const store = data._mathjaxStore;
  if (!store) return data;

  data.content = data.content.replace(/@@(?:MATHJAX_BLOCK_|MATHJAX_INLINE_)\d+@@/g, (token) => (
    Object.prototype.hasOwnProperty.call(store, token) ? store[token] : token
  ));
  return data;
});
