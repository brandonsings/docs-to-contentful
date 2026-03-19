(function () {
  'use strict';

  var inputArea = document.getElementById('inputArea');
  var outputArea = document.getElementById('outputArea');
  var debugArea = document.getElementById('debugArea');
  var copyBtn = document.getElementById('copyBtn');
  var clearBtn = document.getElementById('clearBtn');
  var debugBtn = document.getElementById('debugBtn');

  var PLACEHOLDER_HTML = '<p class="placeholder-text">Paste content on the left to see cleaned output here</p>';
  var lastCleanedHTML = '';
  var lastRawHTML = '';
  var debugVisible = false;

  // ── Configuration ─────────────────────────────────────────────────
  // Tags to remove entirely (with all children)
  var REMOVE_ENTIRELY = new Set([
    'img', 'meta', 'style', 'script', 'link', 'caption', 'colgroup', 'col',
    'noscript', 'iframe', 'object', 'embed', 'video', 'audio', 'source',
    'picture', 'figure', 'figcaption', 'hr', 'svg', 'canvas'
  ]);

  // Tags to unwrap (keep children, remove tag)
  var UNWRAP = new Set([
    'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
    'span', 'font', 'u', 'code', 'pre', 'mark', 'abbr', 'cite', 'dfn',
    'ins', 'kbd', 'samp', 'var', 'wbr', 'bdi', 'bdo', 'ruby', 'rt', 'rp',
    'data', 'time', 'small', 'big', 'center', 'nobr'
  ]);

  // Heading level normalization
  var HEADING_MAP = { H1: 'H2', H5: 'H4', H6: 'H4' };

  // Allowed tags in final output (Contentful Rich Text field)
  var ALLOWED_TAGS = new Set([
    'p', 'h2', 'h3', 'h4', 'b', 'i', 's', 'sup', 'sub',
    'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a', 'br'
  ]);

  // Google Docs detection
  var GDOCS_ID_REGEX = /id="docs-internal-guid/;

  // Chatbot separator patterns
  var SEPARATOR_PATTERN = /^\s*([*\-_]\s*){3,}\s*$/;

  // Fake list detection
  var BULLET_CHARS = /^[\u2022\u25CF\u25CB\u25AA\u25AB\u2023\u25B6\u2192\u2013\u2014\-]\s+/;
  var ORDERED_PREFIX = /^(?:\d+[.)]\s+|[a-z][.)]\s+|[A-Z][.)]\s+|[ivxlcdm]+[.)]\s+)/i;


  // ── Paste handler ─────────────────────────────────────────────────
  inputArea.addEventListener('paste', function (e) {
    e.preventDefault();

    var html = e.clipboardData.getData('text/html');
    var plain = e.clipboardData.getData('text/plain');

    if (html) {
      lastRawHTML = html;
      debugArea.textContent = html;
      var cleaned = cleanHTML(html);
      inputArea.innerHTML = cleaned;
      showOutput(cleaned);
    } else if (plain) {
      var paragraphs = plain.split(/\n\s*\n/).map(function (p) {
        return '<p>' + escapeHTML(p.trim()) + '</p>';
      }).join('');
      inputArea.innerHTML = paragraphs;
      showOutput(paragraphs);
    }
  });

  inputArea.addEventListener('input', function () {
    if (!inputArea.innerHTML || inputArea.innerHTML === '<br>') {
      resetOutput();
      return;
    }
    var cleaned = cleanHTML(inputArea.innerHTML);
    showOutput(cleaned);
  });

  // ── Copy to clipboard ─────────────────────────────────────────────
  copyBtn.addEventListener('click', function () {
    if (!lastCleanedHTML) return;

    var htmlBlob = new Blob([lastCleanedHTML], { type: 'text/html' });
    var textBlob = new Blob([outputArea.innerText], { type: 'text/plain' });

    if (navigator.clipboard && navigator.clipboard.write) {
      navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob
        })
      ]).then(showCopied).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  });

  function fallbackCopy() {
    var range = document.createRange();
    range.selectNodeContents(outputArea);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    try {
      document.execCommand('copy');
      showCopied();
    } catch (err) {
      copyBtn.textContent = 'Copy failed — select and copy manually';
      setTimeout(function () { copyBtn.textContent = 'Copy to Clipboard'; }, 3000);
    }
    sel.removeAllRanges();
  }

  function showCopied() {
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copied');
    setTimeout(function () {
      copyBtn.textContent = 'Copy to Clipboard';
      copyBtn.classList.remove('copied');
    }, 2000);
  }

  // ── Debug toggle ─────────────────────────────────────────────────
  debugBtn.addEventListener('click', function () {
    debugVisible = !debugVisible;
    if (debugVisible) {
      debugArea.hidden = false;
      outputArea.hidden = true;
      debugBtn.textContent = 'Show Output';
    } else {
      debugArea.hidden = true;
      outputArea.hidden = false;
      debugBtn.textContent = 'Show Raw HTML';
    }
  });

  // ── Clear ─────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', function () {
    inputArea.innerHTML = '';
    lastRawHTML = '';
    debugArea.textContent = '';
    resetOutput();
  });

  function showOutput(html) {
    lastCleanedHTML = html;
    outputArea.innerHTML = html;
  }

  function resetOutput() {
    lastCleanedHTML = '';
    outputArea.innerHTML = PLACEHOLDER_HTML;
  }

  function escapeHTML(str) {
    var el = document.createElement('div');
    el.textContent = str;
    return el.innerHTML;
  }

  // ══════════════════════════════════════════════════════════════════
  //  CORE CLEANER
  //
  //  Based on the proven approach used by CKEditor 5, ProseMirror,
  //  Lexical, and the docs-soap library for handling Google Docs HTML.
  //
  //  Key insight: Google Docs clipboard HTML wraps ALL content in
  //  <b style="font-weight:normal;" id="docs-internal-guid-*">.
  //  ALL formatting lives in inline styles on <span> elements.
  //  Google Docs NEVER uses semantic tags (<strong>, <em>, etc.).
  // ══════════════════════════════════════════════════════════════════

  function cleanHTML(htmlString) {
    var isGoogleDocs = GDOCS_ID_REGEX.test(htmlString);
    var doc = new DOMParser().parseFromString(htmlString, 'text/html');
    var body = doc.body;

    // Phase 1: Remove junk
    removeElements(body);
    removeSeparatorParagraphs(body);
    removeGoogleArtifacts(body);

    // Phase 2: Google Docs normalization (the critical path)
    if (isGoogleDocs) {
      unwrapGDocsWrapper(body);     // Remove <b style="font-weight:normal"> wrapper
      unwrapBlockWrappingInlines(body); // Remove <b>/<i> tags wrapping block elements
      convertSpanStylesToTags(body); // Read span styles → create <b>, <i>, <s>
    }

    // Phase 2b: Also run for non-GDocs content (always semantically wrong)
    unwrapBlockWrappingInlines(body);

    // Phase 3: General normalization (works for any source)
    normalizeHeadings(body);
    normalizeInlineTags(body);  // strong→b, em→i, strike/del→s
    cleanLinks(body);
    unwrapDisallowedTags(body);
    stripAllAttributes(body);

    // Phase 4: Structure cleanup
    handleBrTags(body);
    flattenBlockquotes(body);
    cleanTables(body);
    convertFakeLists(body);

    // Phase 5: Contentful-specific rules
    stripFormattingFromHeadings(body);
    unwrapBrFromFormatting(body);

    // Phase 6: Final cleanup
    removeEmptyNodes(body);
    collapseWhitespace(body);
    stripUnallowedTags(body);

    return body.innerHTML.trim();
  }


  // ════════════════════════════════════════════════════════════════
  //  PHASE 1: Remove junk
  // ════════════════════════════════════════════════════════════════

  function removeElements(root) {
    var selectors = Array.from(REMOVE_ENTIRELY).join(',');
    var els = root.querySelectorAll(selectors);
    for (var i = els.length - 1; i >= 0; i--) {
      els[i].parentNode.removeChild(els[i]);
    }
  }

  function removeSeparatorParagraphs(root) {
    var paragraphs = root.querySelectorAll('p');
    for (var i = paragraphs.length - 1; i >= 0; i--) {
      var text = paragraphs[i].textContent.trim();
      if (SEPARATOR_PATTERN.test(text)) {
        paragraphs[i].parentNode.removeChild(paragraphs[i]);
      }
    }
  }

  function removeGoogleArtifacts(root) {
    // Comment anchors
    var anchors = root.querySelectorAll('a[id^="cmnt"]');
    for (var i = anchors.length - 1; i >= 0; i--) {
      anchors[i].parentNode.removeChild(anchors[i]);
    }
    // Suggestion spans
    var suggestions = root.querySelectorAll('[class*="suggestion"]');
    for (var j = suggestions.length - 1; j >= 0; j--) {
      unwrapNode(suggestions[j]);
    }
    // Footnote refs
    var footnotes = root.querySelectorAll('a[href^="#ftnt"]');
    for (var k = footnotes.length - 1; k >= 0; k--) {
      footnotes[k].parentNode.removeChild(footnotes[k]);
    }
    // HTML comments (<!--StartFragment--> etc.)
    removeComments(root);
  }

  function removeComments(node) {
    var walker = node.ownerDocument.createTreeWalker(
      node, NodeFilter.SHOW_COMMENT, null, false
    );
    var comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    for (var i = 0; i < comments.length; i++) {
      comments[i].parentNode.removeChild(comments[i]);
    }
  }


  // ════════════════════════════════════════════════════════════════
  //  PHASE 2: Google Docs normalization
  //
  //  This is the critical fix. Google Docs clipboard HTML looks like:
  //
  //    <b style="font-weight:normal;" id="docs-internal-guid-XXXX">
  //      <h2><span style="font-weight:700;font-style:normal;...">Heading</span></h2>
  //      <p><span style="font-weight:400;font-style:normal;...">Normal text</span></p>
  //      <p><span style="font-weight:700;font-style:normal;...">Bold text</span></p>
  //      <p><span style="font-weight:400;font-style:italic;...">Italic text</span></p>
  //    </b>
  //
  //  Step 1: Unwrap the outer <b> wrapper (it's not real bold)
  //  Step 2: For each <span>, read its inline style and create semantic tags
  //  Step 3: Later phases strip the spans and attributes
  // ════════════════════════════════════════════════════════════════

  // Unwrap the Google Docs bold wrapper: <b style="font-weight:normal" id="docs-internal-guid-*">
  // This is the single most critical step. Every editor (CKEditor, ProseMirror, Lexical) does this.
  function unwrapGDocsWrapper(root) {
    // Find all <b> elements with the docs-internal-guid id
    var wrappers = root.querySelectorAll('b[id^="docs-internal-guid"]');
    for (var i = wrappers.length - 1; i >= 0; i--) {
      unwrapNode(wrappers[i]);
    }

    // Also unwrap any <b> with font-weight:normal (backup detection)
    var bolds = root.querySelectorAll('b[style]');
    for (var j = bolds.length - 1; j >= 0; j--) {
      var style = (bolds[j].getAttribute('style') || '').toLowerCase();
      if (/font-weight\s*:\s*(normal|[1-4]00)/.test(style)) {
        unwrapNode(bolds[j]);
      }
    }

    // Unwrap any <i> with font-style:normal (same pattern, less common)
    var italics = root.querySelectorAll('i[style]');
    for (var k = italics.length - 1; k >= 0; k--) {
      var iStyle = (italics[k].getAttribute('style') || '').toLowerCase();
      if (/font-style\s*:\s*normal/.test(iStyle)) {
        unwrapNode(italics[k]);
      }
    }
  }

  // Unwrap <b>, <i>, <em>, <strong> tags that contain block-level children.
  // In valid HTML, inline formatting tags should only wrap inline content.
  // If they wrap <p>, <h2>, <ul>, etc., they're structural artifacts
  // (common in Google Docs where an <i> tag can wrap the entire second
  // half of a document due to formatting bleed).
  function unwrapBlockWrappingInlines(root) {
    var BLOCK_TAGS = new Set([
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'table',
      'div', 'section', 'article', 'header', 'footer'
    ]);

    var changed = true;
    var maxIterations = 10;
    while (changed && maxIterations-- > 0) {
      changed = false;
      var inlines = root.querySelectorAll('b, i, em, strong, u, s');
      for (var i = inlines.length - 1; i >= 0; i--) {
        var el = inlines[i];
        var children = el.children;
        for (var j = 0; j < children.length; j++) {
          if (BLOCK_TAGS.has(children[j].tagName.toLowerCase())) {
            unwrapNode(el);
            changed = true;
            break;
          }
        }
      }
    }
  }

  // Convert Google Docs inline styles on <span> elements to semantic HTML tags.
  // Google Docs NEVER uses <strong>, <em>, <b>, or <i> for formatting —
  // everything is encoded as CSS on spans.
  function convertSpanStylesToTags(root) {
    var spans = root.querySelectorAll('span[style]');
    for (var i = spans.length - 1; i >= 0; i--) {
      var span = spans[i];
      var style = (span.getAttribute('style') || '').toLowerCase();

      // Read the formatting from inline styles
      var isBold = /font-weight\s*:\s*(bold|[7-9]00)/.test(style);
      var isItalic = /font-style\s*:\s*italic/.test(style);
      var isStrikethrough = /text-decoration\s*:[^;]*line-through/.test(style);
      var isSuperscript = /vertical-align\s*:\s*super/.test(style);
      var isSubscript = /vertical-align\s*:\s*sub/.test(style);

      // Wrap the span's content in semantic tags (outermost to innermost)
      // After this, the span itself will be unwrapped in Phase 3,
      // leaving only the semantic tags behind.
      var currentNode = span;

      if (isSuperscript) {
        currentNode = wrapChildrenIn(currentNode, 'sup', root);
      }
      if (isSubscript) {
        currentNode = wrapChildrenIn(currentNode, 'sub', root);
      }
      if (isStrikethrough) {
        currentNode = wrapChildrenIn(currentNode, 's', root);
      }
      if (isItalic) {
        currentNode = wrapChildrenIn(currentNode, 'i', root);
      }
      if (isBold) {
        wrapChildrenIn(currentNode, 'b', root);
      }
    }
  }

  // Helper: move all children of `parent` into a new element of `tagName`,
  // then append that element as the only child of `parent`.
  // Returns the new wrapper element.
  function wrapChildrenIn(parent, tagName, root) {
    var wrapper = root.ownerDocument.createElement(tagName);
    while (parent.firstChild) {
      wrapper.appendChild(parent.firstChild);
    }
    parent.appendChild(wrapper);
    return wrapper;
  }


  // ════════════════════════════════════════════════════════════════
  //  PHASE 3: General normalization
  // ════════════════════════════════════════════════════════════════

  function normalizeHeadings(root) {
    Object.keys(HEADING_MAP).forEach(function (from) {
      var els = root.querySelectorAll(from);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var replacement = root.ownerDocument.createElement(HEADING_MAP[from]);
        while (el.firstChild) {
          replacement.appendChild(el.firstChild);
        }
        el.parentNode.replaceChild(replacement, el);
      }
    });
  }

  // Normalize: <strong>→<b>, <em>→<i>, <strike>/<del>→<s>
  function normalizeInlineTags(root) {
    var MAP = { STRONG: 'B', EM: 'I', STRIKE: 'S', DEL: 'S' };
    Object.keys(MAP).forEach(function (from) {
      var els = root.querySelectorAll(from);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var replacement = root.ownerDocument.createElement(MAP[from]);
        while (el.firstChild) {
          replacement.appendChild(el.firstChild);
        }
        el.parentNode.replaceChild(replacement, el);
      }
    });
  }

  function cleanLinks(root) {
    var links = root.querySelectorAll('a');
    for (var i = links.length - 1; i >= 0; i--) {
      var a = links[i];
      var href = a.getAttribute('href') || '';

      // Unwrap Google redirect URLs
      var googleRedirect = href.match(/google\.com\/url\?.*?[?&]q=([^&]+)/);
      if (googleRedirect) {
        href = decodeURIComponent(googleRedirect[1]);
        a.setAttribute('href', href);
      }

      // Remove empty, anchor-only, or javascript links
      if (!href || href === '#' || href.startsWith('javascript:') || !a.textContent.trim()) {
        unwrapNode(a);
      }
    }
  }

  function unwrapDisallowedTags(root) {
    var changed = true;
    var maxIterations = 10;
    while (changed && maxIterations-- > 0) {
      changed = false;
      var all = root.querySelectorAll('*');
      for (var i = all.length - 1; i >= 0; i--) {
        var tag = all[i].tagName.toLowerCase();
        if (UNWRAP.has(tag)) {
          unwrapNode(all[i]);
          changed = true;
        }
      }
    }
  }

  function stripAllAttributes(root) {
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var attrs = Array.from(el.attributes);
      for (var j = attrs.length - 1; j >= 0; j--) {
        var name = attrs[j].name;
        if (el.tagName === 'A' && name === 'href') continue;
        el.removeAttribute(name);
      }
    }
  }


  // ════════════════════════════════════════════════════════════════
  //  PHASE 4: Structure cleanup
  // ════════════════════════════════════════════════════════════════

  function handleBrTags(root) {
    var brs = root.querySelectorAll('br');
    for (var i = brs.length - 1; i >= 0; i--) {
      var br = brs[i];
      var parent = br.parentNode;
      if (!parent) continue;

      var parentTag = parent.tagName.toLowerCase();
      var isBlock = ['p', 'h2', 'h3', 'h4', 'li', 'blockquote', 'td', 'th'].indexOf(parentTag) !== -1;

      // Remove <br> between block elements (direct child of body/root)
      if (parentTag === 'body' || parentTag === 'html') {
        parent.removeChild(br);
        continue;
      }

      // Strip <br> at start or end of block elements
      if (isBlock && (br === parent.firstChild || br === parent.lastChild)) {
        parent.removeChild(br);
        continue;
      }

      // Collapse multiple consecutive <br> into a paragraph break
      var next = br.nextSibling;
      if (next && next.nodeName === 'BR') {
        while (next && next.nodeName === 'BR') {
          var toRemove = next;
          next = next.nextSibling;
          parent.removeChild(toRemove);
        }
        if (parentTag === 'p') {
          var newP = root.ownerDocument.createElement('p');
          while (br.nextSibling) {
            newP.appendChild(br.nextSibling);
          }
          parent.removeChild(br);
          if (parent.nextSibling) {
            parent.parentNode.insertBefore(newP, parent.nextSibling);
          } else {
            parent.parentNode.appendChild(newP);
          }
        }
      }
    }
  }

  function flattenBlockquotes(root) {
    var nested = root.querySelectorAll('blockquote blockquote');
    for (var i = nested.length - 1; i >= 0; i--) {
      unwrapNode(nested[i]);
    }
  }

  function cleanTables(root) {
    var nestedTables = root.querySelectorAll('table table');
    for (var i = nestedTables.length - 1; i >= 0; i--) {
      nestedTables[i].parentNode.removeChild(nestedTables[i]);
    }
  }

  function convertFakeLists(root) {
    var paragraphs = Array.from(root.querySelectorAll('p'));
    var i = 0;

    while (i < paragraphs.length) {
      var p = paragraphs[i];
      var text = p.textContent;

      if (BULLET_CHARS.test(text)) {
        var items = [];
        while (i < paragraphs.length && BULLET_CHARS.test(paragraphs[i].textContent)) {
          var li = root.ownerDocument.createElement('li');
          li.innerHTML = paragraphs[i].innerHTML.replace(BULLET_CHARS, '');
          items.push({ li: li, p: paragraphs[i] });
          i++;
        }
        if (items.length > 0) {
          var ul = root.ownerDocument.createElement('ul');
          items.forEach(function (item) { ul.appendChild(item.li); });
          items[0].p.parentNode.insertBefore(ul, items[0].p);
          items.forEach(function (item) { item.p.parentNode.removeChild(item.p); });
        }
        continue;
      }

      if (ORDERED_PREFIX.test(text)) {
        var olItems = [];
        while (i < paragraphs.length && ORDERED_PREFIX.test(paragraphs[i].textContent)) {
          var olLi = root.ownerDocument.createElement('li');
          olLi.innerHTML = paragraphs[i].innerHTML.replace(ORDERED_PREFIX, '');
          olItems.push({ li: olLi, p: paragraphs[i] });
          i++;
        }
        if (olItems.length > 0) {
          var ol = root.ownerDocument.createElement('ol');
          olItems.forEach(function (item) { ol.appendChild(item.li); });
          olItems[0].p.parentNode.insertBefore(ol, olItems[0].p);
          olItems.forEach(function (item) { item.p.parentNode.removeChild(item.p); });
        }
        continue;
      }

      i++;
    }
  }


  // ════════════════════════════════════════════════════════════════
  //  PHASE 5: Contentful-specific rules
  // ════════════════════════════════════════════════════════════════

  // Move <br> elements out of inline formatting tags (<i>, <b>, <s>, etc.).
  // Google Docs wraps <br> inside styled spans, so after convertSpanStylesToTags
  // we get patterns like <i><br></i>. When pasted into Contentful's Slate editor,
  // the italic mark stays "active" at the break and bleeds into following content.
  function unwrapBrFromFormatting(root) {
    var FORMATTING_TAGS = new Set(['i', 'b', 's', 'sup', 'sub']);
    var brs = root.querySelectorAll('br');
    for (var i = brs.length - 1; i >= 0; i--) {
      var br = brs[i];
      var parent = br.parentNode;
      if (!parent) continue;
      if (FORMATTING_TAGS.has(parent.tagName.toLowerCase())) {
        // Move the br after its formatting parent
        if (parent.nextSibling) {
          parent.parentNode.insertBefore(br, parent.nextSibling);
        } else {
          parent.parentNode.appendChild(br);
        }
        // If the formatting tag is now empty, remove it
        if (!parent.textContent.trim() && !parent.querySelector('br, img')) {
          parent.parentNode.removeChild(parent);
        }
      }
    }
  }

  // Headings should NEVER contain <b>, <i>, <s>, etc.
  // Contentful renders heading tags with their own weight,
  // so inner <b> causes "double bold" on the front end.
  function stripFormattingFromHeadings(root) {
    var headingEls = root.querySelectorAll('h2, h3, h4');
    for (var i = 0; i < headingEls.length; i++) {
      var heading = headingEls[i];
      var inlineTags = heading.querySelectorAll('b, i, s, sup, sub');
      for (var j = inlineTags.length - 1; j >= 0; j--) {
        unwrapNode(inlineTags[j]);
      }
    }
  }


  // ════════════════════════════════════════════════════════════════
  //  PHASE 6: Final cleanup
  // ════════════════════════════════════════════════════════════════

  function removeEmptyNodes(root) {
    var changed = true;
    var maxIterations = 5;
    while (changed && maxIterations-- > 0) {
      changed = false;
      var all = root.querySelectorAll('p, b, i, s, sup, sub, a, li, ul, ol, blockquote, span');
      for (var i = all.length - 1; i >= 0; i--) {
        var el = all[i];
        // Treat &nbsp;-only content as empty (replace \u00A0 before trimming)
        var text = el.textContent.replace(/\u00A0/g, ' ').trim();
        if (!text && !el.querySelector('img, br, table')) {
          el.parentNode.removeChild(el);
          changed = true;
        }
      }
    }
  }

  function collapseWhitespace(root) {
    var BLOCK_TAGS = new Set([
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'td', 'th'
    ]);
    var walker = root.ownerDocument.createTreeWalker(
      root, NodeFilter.SHOW_TEXT, null, false
    );
    var node;
    while ((node = walker.nextNode())) {
      node.nodeValue = node.nodeValue.replace(/[ \t\r\n]+/g, ' ');

      // Strip leading whitespace (including &nbsp;) if this text node starts a block or follows a <br>
      if (node.nodeValue.charAt(0) === ' ' || node.nodeValue.charAt(0) === '\u00A0') {
        var prev = node.previousSibling;
        var isAfterBr = prev && prev.nodeName === 'BR';
        var isBlockStart = !prev && BLOCK_TAGS.has((node.parentNode.tagName || '').toLowerCase());
        if (isAfterBr || isBlockStart) {
          node.nodeValue = node.nodeValue.replace(/^[\s\u00A0]+/, '');
        }
      }
    }
  }

  function stripUnallowedTags(root) {
    var all = root.querySelectorAll('*');
    for (var i = all.length - 1; i >= 0; i--) {
      var tag = all[i].tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        unwrapNode(all[i]);
      }
    }
  }


  // ════════════════════════════════════════════════════════════════
  //  Utility
  // ════════════════════════════════════════════════════════════════

  function unwrapNode(node) {
    var parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node);
    }
    parent.removeChild(node);
  }

})();
