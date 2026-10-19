/** Prompts and output parsing for the publication AI features. */

export const PRESS_SYSTEM = 'You are a writing and layout assistant inside QuillPress, an offline-first desktop publishing app. Follow the format instructions exactly. Do not add commentary before or after the requested output.';

export interface DraftPage { heading: string; deck?: string; body: string[]; sidebar?: { heading: string; body: string[] }; pullQuote?: string; caption?: string }
export interface DraftPublication { title: string; subtitle?: string; pages: DraftPage[] }

export const DRAFT_FORMAT = 'Reply with JSON only: {"title": string, "subtitle": string, "pages": [{"heading": string, "deck": string (one-sentence summary under the heading), "body": [string, …] (paragraphs of running text, 60–120 words each), "sidebar": {"heading": string, "body": [string, …]} (optional box of related facts), "pullQuote": string (optional, a short striking sentence from the body), "caption": string (optional caption for a picture)}]}.';

export function draftPublicationPrompt(brief: string, pages: number, kind: string, audience: string, tone: string): string {
  return `Write the text for a ${kind} of about ${pages} page(s) about: ${brief}\nAudience: ${audience || 'general'}\nTone: ${tone || 'clear and professional'}\nEach page is one article or section with a heading, a deck, body paragraphs and optionally a sidebar, a pull quote and a picture caption. Use concrete detail; do not invent statistics.\n${DRAFT_FORMAT}`;
}

export function draftStoryPrompt(topic: string, words: number, tone: string): string {
  return `Write an article of about ${words} words about: ${topic}\nTone: ${tone || 'clear and professional'}\nStart with a headline on the first line, then a one-sentence deck on the second line, then the body paragraphs separated by blank lines. No markdown, no bullet characters.`;
}

export const TEXT_TASKS: Record<string, { label: string; prompt: (t: string, arg?: string) => string }> = {
  rewrite: { label: 'Rewrite', prompt: (t) => `Rewrite this text to be clearer and more direct. Keep the same paragraphs (one per line) and the meaning.\n"""\n${t}\n"""` },
  shorten: { label: 'Shorten', prompt: (t, pct) => `Shorten this text to about ${pct || '70'}% of its length, keeping the key points and the paragraph structure (one paragraph per line).\n"""\n${t}\n"""` },
  expand: { label: 'Expand', prompt: (t) => `Expand this text with concrete detail to about one and a half times its length, keeping the paragraph structure (one paragraph per line).\n"""\n${t}\n"""` },
  tone: { label: 'Change Tone', prompt: (t, tone) => `Rewrite this text in a ${tone || 'more formal'} tone. One paragraph per line of input.\n"""\n${t}\n"""` },
  proofread: { label: 'Proofread', prompt: (t) => `Correct spelling, grammar and punctuation in this text. Change nothing else; keep line breaks.\n"""\n${t}\n"""` },
  translate: { label: 'Translate', prompt: (t, lang) => `Translate into ${lang || 'English'}. Keep line breaks; reply with the translation only.\n"""\n${t}\n"""` },
  headlines: { label: 'Suggest Headlines', prompt: (t) => `Suggest 6 headlines for this article, from straightforward to playful, at most 10 words each. One per line, no numbering.\n"""\n${t}\n"""` },
  decks: { label: 'Suggest Decks', prompt: (t) => `Write 4 possible decks (one-sentence summaries printed under the headline, at most 25 words) for this article. One per line.\n"""\n${t}\n"""` },
  pullQuotes: { label: 'Suggest Pull Quotes', prompt: (t) => `Pick 5 short, striking sentences from this text that would work as pull quotes (quote them exactly as written, at most 20 words). One per line, no numbering, no quotation marks.\n"""\n${t}\n"""` },
  captions: { label: 'Write Caption', prompt: (t) => `Write 3 possible captions (one sentence each, at most 20 words) for a picture described as: ${t}. One per line.` },
  altText: { label: 'Generate Alt Text', prompt: (t) => `Write alternative text (one sentence, at most 25 words, no "image of") for this picture in a publication. Context: ${t}` },
  summarize: { label: 'Summarize', prompt: (t) => `Summarize this publication's text in 4–6 short sentences for a summary box. One sentence per line.\n"""\n${t}\n"""` },
  styles: { label: 'Suggest Styles', prompt: (t) => `For each numbered paragraph below, say which role it plays: Headline, Deck, Byline, Heading 2, Heading 3, Body, Bullet List, Pull Quote, Caption or Contact. Reply with JSON only: an array of role strings in order.\n"""\n${t}\n"""` },
  layout: { label: 'Layout Suggestions', prompt: (t) => `You are an experienced page layout designer. Here is a description of a page. Give 5 specific, practical suggestions to improve its layout and typography (numbered, one or two sentences each).\n"""\n${t}\n"""` },
  fit: { label: 'Fit Copy', prompt: (t, chars) => `Shorten this text by about ${chars} characters without losing its key points. Keep the paragraph structure (one paragraph per line) and the headline if any.\n"""\n${t}\n"""` },
};

/** Strips code fences, quotes and bullet characters the model may add. */
export function cleanText(s: string): string {
  return s.replace(/^```[a-z]*\s*|\s*```$/gi, '').replace(/^"""|"""$/g, '').trim();
}

export function linesOf(s: string): string[] {
  return cleanText(s).split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, '').trimEnd()).filter((l) => l.trim());
}

/** Parses JSON that may be wrapped in prose or code fences. */
export function parseJsonLoose<T = any>(s: string): T | null {
  const t = cleanText(s);
  try { return JSON.parse(t); } catch { /* look inside */ }
  const a = t.indexOf('['), o = t.indexOf('{');
  const start = a >= 0 && (o < 0 || a < o) ? a : o;
  if (start < 0) return null;
  const close = t[start] === '[' ? ']' : '}';
  const end = t.lastIndexOf(close);
  if (end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

/** Parses a draft publication answer (JSON first, then headings and paragraphs). */
export function parseDraft(s: string): DraftPublication | null {
  const j = parseJsonLoose<any>(s);
  if (j && Array.isArray(j.pages)) {
    return { title: String(j.title || 'Untitled'), subtitle: j.subtitle ? String(j.subtitle) : undefined, pages: j.pages.filter((p: any) => p && (p.heading || p.body)).map((p: any) => ({ heading: String(p.heading || ''), deck: p.deck ? String(p.deck) : undefined, body: Array.isArray(p.body) ? p.body.map(String) : typeof p.body === 'string' ? p.body.split(/\n+/) : [], sidebar: p.sidebar?.heading ? { heading: String(p.sidebar.heading), body: Array.isArray(p.sidebar.body) ? p.sidebar.body.map(String) : [] } : undefined, pullQuote: p.pullQuote ? String(p.pullQuote) : undefined, caption: p.caption ? String(p.caption) : undefined })) };
  }
  const pages: DraftPage[] = [];
  let title = '';
  for (const raw of cleanText(s).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1 && !title) { title = h1[1]; continue; }
    const head = /^#{1,3}\s+(.*)$/.exec(line);
    if (head) { pages.push({ heading: head[1].replace(/\*\*/g, ''), body: [] }); continue; }
    if (!pages.length) pages.push({ heading: line, body: [] });
    else pages[pages.length - 1].body.push(line.replace(/^(?:[-*•]|\d+[.)])\s+/, ''));
  }
  return pages.length ? { title: title || pages[0].heading, pages } : null;
}
