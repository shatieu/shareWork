import { describe, expect, it } from 'vitest';
import { extractFirstH1, extractHeadings, extractImages, extractLinks } from '../src/markdown.js';

const SAMPLE = `---
id: doc-a
---

# Title

## Section One

See the [auth spec](../arch/auth.md "id:auth-arch") and ![diagram](assets/auth/flow.png).

A [reference link][1] and <https://example.com/auto> pass through untouched.

\`\`\`md
[fake link](fake.md "id:should-not-match")
\`\`\`

[1]: https://example.com/ref
`;

describe('extractHeadings / extractFirstH1', () => {
  it('lists heading text in document order', () => {
    expect(extractHeadings(SAMPLE)).toEqual(['Title', 'Section One']);
  });

  it('extracts the first H1', () => {
    expect(extractFirstH1(SAMPLE)).toBe('Title');
  });
});

describe('extractLinks', () => {
  it('finds inline links with href, title, and a usable urlPosition', () => {
    const links = extractLinks(SAMPLE);
    const authLink = links.find((l) => l.href === '../arch/auth.md');
    expect(authLink).toBeDefined();
    expect(authLink!.titleAttr).toBe('id:auth-arch');
    expect(authLink!.urlPosition).toBeDefined();
    expect(SAMPLE.slice(authLink!.urlPosition!.start, authLink!.urlPosition!.end)).toBe('../arch/auth.md');
  });

  it('does not find links inside fenced code blocks', () => {
    const links = extractLinks(SAMPLE);
    expect(links.some((l) => l.href === 'fake.md')).toBe(false);
  });

  it('still discovers reference-style and autolink forms (no urlPosition expected)', () => {
    const links = extractLinks(SAMPLE);
    const auto = links.find((l) => l.href === 'https://example.com/auto');
    expect(auto).toBeDefined();
  });
});

describe('extractImages', () => {
  it('finds image nodes with href', () => {
    const images = extractImages(SAMPLE);
    expect(images).toHaveLength(1);
    expect(images[0].href).toBe('assets/auth/flow.png');
  });
});
