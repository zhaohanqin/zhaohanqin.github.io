/*!
 * figure-wrap.js
 *
 * 在文章渲染完成后，把独立成段的 <img> 包装为带编号图注的 <figure>：
 *   <figure class="article-figure">
 *     <img ...>
 *     <figcaption>图1：图片说明</figcaption>
 *   </figure>
 * 编号在每篇文章内从 1 开始自动递增（图1、图2、……）。
 * 仅处理单独成段的图片，不处理文字中内联的图片。
 * 该文件由 Hexo 自动从站点根 scripts/ 目录加载。
 */
'use strict';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

hexo.extend.filter.register('after_post_render', function (data) {
  if (!data || typeof data.content !== 'string') return data;

  let figureIndex = 0;

  data.content = data.content.replace(
    /<p>\s*(<img\b[^>]*?)\s*\/?>\s*<\/p>/g,
    (whole, imgTag) => {
      figureIndex += 1;

      const src = (imgTag.match(/src="([^"]*)"/) || [])[1] || '';
      const alt = (imgTag.match(/alt="([^"]*)"/) || [])[1] || '';
      const rest = imgTag
        .replace(/^<img\b/, '')
        .replace(/src="[^"]*"/, '')
        .replace(/alt="[^"]*"/, '')
        .replace(/\s+/g, ' ')
        .trim();

      const caption = alt ? `图${figureIndex}：${alt}` : `图${figureIndex}`;
      const img = `<img src="${src}" alt="${escapeHtml(alt)}"${rest ? ' ' + rest : ''}>`;

      return `<figure class="article-figure">${img}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
    }
  );

  return data;
});
