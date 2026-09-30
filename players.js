/** Manual input is an adapter. The engine only receives player records. */
export function parseManualPlayers(text) {
  return text.split(/\r?\n/).map(name => name.trim()).filter(Boolean)
    .map((name, index) => ({ id: `player-${index + 1}`, name }));
}
