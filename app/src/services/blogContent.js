function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeUrl(rawUrl) {
  const input = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!input) return '';
  if (input.startsWith('/')) return input;
  if (/^https?:\/\//i.test(input)) return input;
  return '';
}

function renderInlineMarkdown(text) {
  const src = typeof text === 'string' ? text : '';
  let out = escapeHtml(src);

  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
    const safeUrl = normalizeUrl(url);
    if (!safeUrl) return escapeHtml(label);
    return `<a href="${escapeHtml(safeUrl)}" class="text-primary underline">${escapeHtml(label)}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

  return out;
}

function markdownToHtml(markdown) {
  const raw = typeof markdown === 'string' ? markdown : '';
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');

  const blocks = [];
  let paragraph = [];
  let inList = false;
  let listItems = [];
  let inCode = false;
  let codeLines = [];
  let inQuote = false;
  let quoteLines = [];

  function flushCode() {
    if (!inCode) return;
    const code = escapeHtml(codeLines.join('\n'));
    blocks.push(`<pre><code>${code}</code></pre>`);
    inCode = false;
    codeLines = [];
  }

  function flushQuote() {
    if (!inQuote) return;
    const joined = quoteLines.join('\n').trim();
    if (joined) {
      const html = joined
        .split('\n')
        .map((l) => renderInlineMarkdown(l.trim()))
        .join('<br/>');
      blocks.push(`<blockquote>${html}</blockquote>`);
    }
    inQuote = false;
    quoteLines = [];
  }

  function flushParagraph() {
    if (!paragraph.length) return;
    const joined = paragraph.join(' ').trim();
    if (joined) blocks.push(`<p>${renderInlineMarkdown(joined)}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!inList) return;
    const items = listItems
      .map((li) => `<li>${renderInlineMarkdown(li)}</li>`)
      .join('');
    blocks.push(`<ul>${items}</ul>`);
    inList = false;
    listItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      flushQuote();
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line.replace(/\t/g, '  '));
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push('<hr/>');
      continue;
    }

    const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(trimmed);
    if (imageMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const alt = String(imageMatch[1] || '').trim();
      const url = normalizeUrl(imageMatch[2]);
      if (url) {
        blocks.push(`<p><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy"/></p>`);
      }
      continue;
    }

    const yt = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/.exec(trimmed);
    if (yt && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
      const videoId = yt[4] ? String(yt[4]).split(/[?&]/)[0] : '';
      if (videoId) {
        flushParagraph();
        flushList();
        flushQuote();
        blocks.push(
          `<div style="position:relative;padding-top:56.25%;margin:1rem 0;border-radius:0.75rem;overflow:hidden;">`
          + `<iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(videoId)}" `
          + `title="YouTube video" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" `
          + `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`
          + `</div>`
        );
      }
      continue;
    }

    const boldTitleMatch = /^\*\*([^*]+)\*\*$/.exec(trimmed);
    if (boldTitleMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const value = boldTitleMatch[1].trim();
      if (value) {
        const isNumbered = /^\d+[).]\s+/.test(value);
        const tag = isNumbered ? 'h4' : 'h3';
        blocks.push(`<${tag}>${renderInlineMarkdown(value)}</${tag}>`);
      }
      continue;
    }

    const numberedTitleMatch = /^\d+[).]\s+(.+)$/.exec(trimmed);
    if (numberedTitleMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const value = trimmed;
      blocks.push(`<h4>${renderInlineMarkdown(value)}</h4>`);
      continue;
    }

    const h3 = trimmed.startsWith('### ') ? trimmed.slice(4).trim() : '';
    const h2 = !h3 && trimmed.startsWith('## ') ? trimmed.slice(3).trim() : '';
    const h1 = !h3 && !h2 && trimmed.startsWith('# ') ? trimmed.slice(2).trim() : '';

    if (h1 || h2 || h3) {
      flushParagraph();
      flushList();
      flushQuote();
      const tag = h1 ? 'h2' : h2 ? 'h3' : 'h4';
      const value = h1 || h2 || h3;
      blocks.push(`<${tag}>${renderInlineMarkdown(value)}</${tag}>`);
      continue;
    }

    const quoteMatch = /^>\s*(.*)$/.exec(trimmed);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      inQuote = true;
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    if (inQuote) {
      flushQuote();
    }

    const listMatch = /^(-|\*)\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      inList = true;
      listItems.push(listMatch[2].trim());
      continue;
    }

    if (inList) {
      flushList();
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();
  flushCode();

  return blocks.join('\n');
}

function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
  escapeHtml,
  markdownToHtml,
  stripHtml,
};
