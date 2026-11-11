import type { ReactNode } from "react";

// A tiny, safe Markdown renderer for daily scripts. It builds React elements (never raw HTML), so any HTML in the
// text shows as text. Covers headings, paragraphs (line breaks kept), lists, quotes, code, tables, rules,
// **bold**, *italic*, `code`, ~~strike~~ and [links](https://…) (http, https, mailto and site paths only).

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;
const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*(?!\s)([^*\n]+?)\*|(^|[\s(])_(?!\s)([^_\n]+?)_(?=[\s.,;:!?)]|$)|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function inline(text: string, k = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, n = 0;
  const re = new RegExp(INLINE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let start = m.index;
    if (m[7] !== undefined) start += m[7].length; // keep the space before _em_
    if (start > last) out.push(text.slice(last, start));
    const key = `${k}${n++}`;
    if (m[2] !== undefined) out.push(<code key={key} className="rounded bg-chip px-1 py-0.5 font-mono text-[0.9em]">{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={key}>{inline(m[3] ?? m[4], key)}</strong>);
    else if (m[5] !== undefined) out.push(<s key={key}>{inline(m[5], key)}</s>);
    else if (m[6] !== undefined || m[8] !== undefined) out.push(<em key={key}>{inline(m[6] ?? m[8], key)}</em>);
    else if (m[9] !== undefined) {
      const url = m[10];
      out.push(SAFE_URL.test(url)
        ? <a key={key} href={url} className="text-brand-t underline" {...(/^https?:/i.test(url) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{inline(m[9], key)}</a>
        : <span key={key}>{inline(m[9], key)}</span>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Lines joined with <br>, like a script reads.
function lines(ls: string[], k: string): ReactNode[] {
  return ls.flatMap((l, i) => (i ? [<br key={`${k}b${i}`} />, ...inline(l, `${k}l${i}`)] : inline(l, `${k}l${i}`)));
}

const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const src = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, b = 0;
  const key = () => `b${b++}`;
  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const body: string[] = [];
      for (i++; i < src.length && !src[i].trim().startsWith(fence[1]); i++) body.push(src[i]);
      i++;
      blocks.push(<pre key={key()} className="overflow-x-auto rounded-xl bg-chip p-3 font-mono text-[13px] leading-relaxed">{body.join("\n")}</pre>);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const lv = h[1].length, k = key(), kids = inline(h[2], k);
      if (lv === 1) blocks.push(<h1 key={k} className="mt-6 mb-2 font-serif text-2xl tracking-tight first:mt-0">{kids}</h1>);
      else if (lv === 2) blocks.push(<h2 key={k} className="mt-6 mb-2 font-serif text-xl tracking-tight first:mt-0">{kids}</h2>);
      else if (lv === 3) blocks.push(<h3 key={k} className="mt-5 mb-1.5 text-base font-semibold first:mt-0">{kids}</h3>);
      else blocks.push(<h4 key={k} className="mt-4 mb-1 text-sm font-semibold uppercase tracking-wide text-muted first:mt-0">{kids}</h4>);
      i++; continue;
    }
    if (HR.test(line)) { blocks.push(<hr key={key()} className="my-5 border-line" />); i++; continue; }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      for (; i < src.length && /^\s*>/.test(src[i]); i++) q.push(src[i].replace(/^\s*>\s?/, ""));
      const k = key();
      blocks.push(<blockquote key={k} className="my-3 border-l-2 border-brand pl-3 text-muted">{lines(q, k)}</blockquote>);
      continue;
    }
    if (line.includes("|") && i + 1 < src.length && TABLE_SEP.test(src[i + 1])) {
      const head = cells(line), rows: string[][] = [];
      for (i += 2; i < src.length && src[i].includes("|") && src[i].trim(); i++) rows.push(cells(src[i]));
      const k = key();
      blocks.push(
        <div key={k} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr>{head.map((c, j) => <th key={j} className="border-b border-line px-2 py-1.5 text-left font-semibold">{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="border-b border-line px-2 py-1.5 align-top">{inline(c, `${k}${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    if (LIST.test(line)) {
      const items: { indent: number; ordered: boolean; text: string[] }[] = [];
      for (; i < src.length; i++) {
        const m = src[i].match(LIST);
        if (m && items.length && m[1].length <= items[0].indent && /\d/.test(m[2]) !== items[0].ordered) break; // - list then 1. list
        if (m) { items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: [m[3]] }); continue; }
        if (src[i].trim() && /^\s+/.test(src[i]) && items.length) { items[items.length - 1].text.push(src[i].trim()); continue; }
        break;
      }
      const k = key(), ordered = items[0].ordered, base = items[0].indent;
      const lis = items.map((it, j) => (
        <li key={j} className={it.indent > base ? "ml-5" : ""} style={it.ordered !== ordered ? { listStyleType: it.ordered ? "decimal" : "disc" } : undefined}>
          {lines(it.text, `${k}${j}`)}
        </li>));
      blocks.push(ordered
        ? <ol key={k} className="my-3 list-decimal space-y-1 pl-5">{lis}</ol>
        : <ul key={k} className="my-3 list-disc space-y-1 pl-5">{lis}</ul>);
      continue;
    }
    const para: string[] = [];
    for (; i < src.length && src[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(src[i]) && !LIST.test(src[i]) && !HR.test(src[i]); i++) para.push(src[i].trim());
    if (!para.length) { para.push(line.trim()); i++; }
    const k = key();
    blocks.push(<p key={k} className="my-3 leading-relaxed">{lines(para, k)}</p>);
  }
  return <div className="text-[15px] break-words">{blocks}</div>;
}
