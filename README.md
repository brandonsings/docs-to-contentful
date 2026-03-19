# Docs to Contentful Converter

**Because Google Docs clipboard HTML is a crime against markup.**

You know the drill. Your writers draft in Google Docs. Your CMS is Contentful. Somewhere between "copy" and "paste," the HTML turns into a war crime of nested `<span>` tags, phantom `font-weight:400`, and 47 CSS properties per character — including gems like `white-space:pre;white-space:pre-wrap;` (yes, both, because why not).

This tool fixes that.

## What it does

Paste from Google Docs on the left. Get clean, Contentful-ready HTML on the right. Copy it. Paste it into Contentful. Done.

No server. No signup. No "start your free trial." No npm install. No webpack. No Docker. It's three files.

## What it cleans

- **Google Docs' infamous `<b style="font-weight:normal">` wrapper** — the single most unhinged HTML decision in the history of clipboard APIs
- **Span style soup** — converts `font-weight:700` and `font-style:italic` on spans into actual `<b>` and `<i>` tags like a civilized parser
- **Heading normalization** — H1 becomes H2, H5/H6 become H4 (Contentful's rules, not ours)
- **Link laundering** — unwraps Google's redirect URLs (`google.com/url?q=THE_ACTUAL_URL`) so your links actually go where they should
- **Fake lists** — detects paragraphs that start with bullet characters and converts them to real `<ul>`/`<ol>` elements
- **The italic `<br>` problem** — Google Docs wraps `<br>` tags inside italic spans, which makes Contentful's Slate editor think everything after the break should be italic forever. We fixed it. You're welcome.
- **Empty paragraphs, orphan `<br>` tags, `&nbsp;` ghosts** — all gone
- **Every `class`, `style`, `id`, and `data-*` attribute** — stripped. Contentful doesn't want them. Neither do you.

## What Contentful gets

Only the tags Contentful's Rich Text field actually supports:

`<p>` `<h2>` `<h3>` `<h4>` `<b>` `<i>` `<s>` `<sup>` `<sub>` `<ul>` `<ol>` `<li>` `<blockquote>` `<table>` `<a>` `<br>`

Nothing else. No `<div>`. No `<span>`. No `<font>`. No `<center>` (it's 2026, let it go).

## How to run it

Open `index.html` in a browser.

That's it. That's the deploy.

Or visit [docs-to-contentful.com](https://docs-to-contentful.com) like a normal person.

## Tech stack

- HTML
- CSS
- JavaScript
- Spite

## Built by

[Brandon Whalen](https://www.linkedin.com/in/brandonwhalen/) and a mass quantity of caffeine.
