/** Split "REAL New York (29 West 30th Street, ...)" into name and office. */
export function splitBrokerage(raw: string): {brokerageName: string; officeAddress: string} {
  const trimmed = raw.trim();
  const match = /^(.*)\(([^)]+)\)\s*$/.exec(trimmed);
  if (!match) {
    return {brokerageName: trimmed, officeAddress: ''};
  }
  return {brokerageName: match[1]!.trim(), officeAddress: match[2]!.trim()};
}

export function isStreetEasyAlert(from: string): boolean {
  return from.toLowerCase().includes('noreply@email.streeteasy.com');
}
