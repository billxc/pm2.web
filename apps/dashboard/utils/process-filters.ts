// Ordered, case-insensitive partial matching: "org" matches both "aorg" and "orange".
export function matchesProcessName(name: string, search: string): boolean {
  const normalized = name.toLowerCase();
  let position = 0;
  return [...search.trim().toLowerCase()].every((character) => {
    const index = normalized.indexOf(character, position);
    position = index + character.length;
    return index !== -1;
  });
}
