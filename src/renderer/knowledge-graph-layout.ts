interface LayoutNode {
  id: string;
  kind: string;
  label: string;
}
function labelLines(label: string): string[] {
  const lines: string[] = [];
  let line = '',
    width = 0;
  for (const character of label) {
    const size = character.codePointAt(0)! > 255 ? 2 : 1;
    if (character === '\n') {
      lines.push(line + character);
      line = '';
      width = 0;
      continue;
    }
    if (width + size > 30 && line) {
      lines.push(line);
      line = '';
      width = 0;
    }
    line += character;
    width += size;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
export function layoutKnowledgeNodes(nodes: LayoutNode[]) {
  const nextY = [24, 24, 24, 24];
  const positions = new Map(
    nodes.map((node) => {
      const column = ['fragment', 'material', 'source'].includes(node.kind)
        ? 0
        : ['attempt', 'session', 'teachingVersion', 'teaching_version'].includes(node.kind)
          ? 1
          : node.kind === 'evidence'
            ? 2
            : 3;
      const lines = labelLines(node.label),
        height = Math.max(64, lines.length * 18 + 24);
      const position = { x: 24 + column * 330, y: nextY[column], width: 230, height, lines };
      nextY[column] += height + 64;
      return [node.id, position] as const;
    }),
  );
  return { positions, width: 1268, height: Math.max(...nextY, 120) };
}
