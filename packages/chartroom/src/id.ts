const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Slugify a title or filename stem into a short, human-readable, URL/YAML-safe id fragment.
 * Lowercase, ASCII alnum + hyphens only, diacritics stripped, no leading/trailing/duplicate hyphens.
 * Falls back to "doc" if the input has no usable characters.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'doc';
}

/**
 * Generate a unique id from a base string (title or filename stem), de-duplicating against a
 * given set of already-assigned ids by appending `-2`, `-3`, ... Stable: the same title against
 * an empty existing-id set always yields the same slug.
 */
export function generateId(base: string, existingIds: ReadonlySet<string>): string {
  const slug = slugify(base);
  if (!existingIds.has(slug)) {
    return slug;
  }
  let n = 2;
  while (existingIds.has(`${slug}-${n}`)) {
    n += 1;
  }
  return `${slug}-${n}`;
}
