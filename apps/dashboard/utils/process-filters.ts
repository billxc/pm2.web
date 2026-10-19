// Literal substrings, in order: "web" stays contiguous; "w e b" can skip characters.
export function matchesProcessName(name: string, search: string): boolean {
  const normalized = name.toLowerCase();
  let position = 0;
  return search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((part) => {
      const index = normalized.indexOf(part, position);
      position = index + part.length;
      return index !== -1;
    });
}
