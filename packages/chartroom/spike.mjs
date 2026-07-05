import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';

const raw = `---
id: doc-a
---

# Title

See the [auth spec](../arch/auth.md "id:auth-arch") and ![diagram](assets/auth/flow.png) plus a [ref link][1] and <https://example.com/auto>.

\`\`\`md
[fake link](fake.md "id:should-not-match")
\`\`\`

[1]: https://example.com/ref
`;

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml']);
const tree = processor.parse(raw);
visit(tree, (node) => {
  if (node.type === 'link' || node.type === 'image' || node.type === 'linkReference' || node.type === 'yaml' || node.type === 'code') {
    console.log(node.type, JSON.stringify(node.position), 'url=' + node.url, 'title=' + node.title);
    if (node.position) {
      console.log('  slice:', JSON.stringify(raw.slice(node.position.start.offset, node.position.end.offset)));
    }
  }
});
