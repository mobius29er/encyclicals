export function bionicWord(w: string): string {
  const n = w.length;
  if (n <= 1) return `<span class="bw">${w}</span>`;
  const b = n <= 3 ? 1 : n <= 5 ? 2 : n <= 8 ? 3 : Math.ceil(n * 0.4);
  return `<span class="bw">${w.slice(0, b)}</span>${w.slice(b)}`;
}

export function applyNDToHtml(html: string): string {
  let h = html;
  const parts = h.split(/(<[^>]+>)/g);
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] && parts[i].charAt(0) !== '<') {
      parts[i] = parts[i].replace(/([A-Za-z\u00C0-\u024F\u2019]+)/g, (match) => bionicWord(match));
    }
  }
  h = parts.join('');
  const tags: string[] = [];
  h = h.replace(/<[^>]+>/g, (tag) => {
    tags.push(tag);
    return `\u0000T${tags.length - 1}\u0000`;
  });
  h = h.replace(/([.!?][\u201d\u2019)]?)\s+/g, '$1</span>\n<span class="sentence">');
  h = h.replace(/\u0000T(\d+)\u0000/g, (_, i) => tags[Number.parseInt(i, 10)] ?? '');
  return `<span class="sentence">${h}</span>`;
}

export function removeNDFromHtml(html: string): string {
  return html;
}
