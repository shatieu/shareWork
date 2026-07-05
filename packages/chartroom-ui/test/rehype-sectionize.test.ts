import { describe, expect, it } from 'vitest';
import { groupIntoSections, type HastNode } from '../src/rehype/rehype-sectionize.js';

function heading(depth: number, text: string): HastNode {
  return {
    type: 'element',
    tagName: `h${depth}`,
    properties: {},
    children: [{ type: 'text', value: text }],
  };
}

function paragraph(text: string): HastNode {
  return {
    type: 'element',
    tagName: 'p',
    properties: {},
    children: [{ type: 'text', value: text }],
  };
}

describe('groupIntoSections', () => {
  it('passes through unchanged when there are no headings at all', () => {
    const nodes = [paragraph('a'), paragraph('b')];
    expect(groupIntoSections(nodes)).toEqual(nodes);
  });

  it('wraps a single flat heading + body into one <details><summary>', () => {
    const nodes = [heading(1, 'Title'), paragraph('body')];
    const result = groupIntoSections(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe('details');
    expect(result[0].properties).toEqual({ open: true });
    expect(result[0].children?.[0].tagName).toBe('summary');
    expect(result[0].children?.[0].children?.[0]).toEqual(heading(1, 'Title'));
    expect(result[0].children?.[1]).toEqual(paragraph('body'));
  });

  it('a heading of equal-or-shallower depth closes the previous section', () => {
    const nodes = [heading(2, 'First'), paragraph('body1'), heading(2, 'Second'), paragraph('body2')];
    const result = groupIntoSections(nodes);
    expect(result).toHaveLength(2);
    expect(result[0].tagName).toBe('details');
    expect(result[0].children?.[0].children?.[0]).toEqual(heading(2, 'First'));
    expect(result[0].children?.[1]).toEqual(paragraph('body1'));
    expect(result[1].tagName).toBe('details');
    expect(result[1].children?.[0].children?.[0]).toEqual(heading(2, 'Second'));
    expect(result[1].children?.[1]).toEqual(paragraph('body2'));
  });

  it('nests a deeper heading (h2 following h1) into a nested <details>', () => {
    const nodes = [heading(1, 'Top'), paragraph('intro'), heading(2, 'Sub'), paragraph('sub-body')];
    const result = groupIntoSections(nodes);
    expect(result).toHaveLength(1);
    const topDetails = result[0];
    expect(topDetails.tagName).toBe('details');
    // children: [summary(Top), intro-paragraph, nested details(Sub)]
    expect(topDetails.children).toHaveLength(3);
    expect(topDetails.children?.[1]).toEqual(paragraph('intro'));
    const nested = topDetails.children?.[2];
    expect(nested?.tagName).toBe('details');
    expect(nested?.children?.[0].tagName).toBe('summary');
    expect(nested?.children?.[1]).toEqual(paragraph('sub-body'));
  });

  it('a mixed sequence of depths (h1, h3, h2) closes h3 when h2 arrives (equal-or-shallower than h1 does not apply, h2 < h3)', () => {
    const nodes = [heading(1, 'A'), heading(3, 'A.deep'), paragraph('deep-body'), heading(2, 'B')];
    const result = groupIntoSections(nodes);
    expect(result).toHaveLength(1); // h2 is deeper than h1, so still nested under A
    const aDetails = result[0];
    // children: [summary(A), nested-details(A.deep with deep-body), nested-details(B)]
    expect(aDetails.children).toHaveLength(3);
    expect(aDetails.children?.[1].tagName).toBe('details');
    expect(aDetails.children?.[2].tagName).toBe('details');
  });
});
