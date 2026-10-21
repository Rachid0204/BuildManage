/** Only attachment fields confer file access; a URL mentioned in a note does not. */
const fields = new Set(['photoUrl', 'photos', 'images', 'imageUrl', 'receiptUrl', 'attachmentUrl', 'stepPhotos']);
export function privateAttachments(value: unknown): Set<string> {
  const urls = new Set<string>();
  function visit(item: unknown, field = '') {
    if (typeof item === 'string') {
      if (fields.has(field) && item.startsWith('/api/uploads/')) urls.add(item);
    } else if (Array.isArray(item)) item.forEach(child => visit(child, field));
    else if (item && typeof item === 'object')
      Object.entries(item).forEach(([key, child]) => visit(child, key));
  }
  visit(value);
  return urls;
}
