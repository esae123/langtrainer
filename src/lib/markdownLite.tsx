import type { ReactNode } from 'react';

// Tiny hand-written markdown renderer for Topic.context (docs/content-authoring.md §3):
// paragraphs, a single-line "# heading", "**bold**" / "*italic*" inline spans, and
// "- " bullet / "1. " numbered lists. Anything else is shown as plain text.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${i}`}>{match[1]}</strong>);
    } else {
      nodes.push(<em key={`${keyPrefix}-${i}`}>{match[2]}</em>);
    }
    lastIndex = pattern.lastIndex;
    i += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function MiniMarkdown({ text }: { text: string }) {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
      {blocks.map((block, blockIndex) => {
        const lines = block
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        const key = `b${blockIndex}`;

        if (lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l))) {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>{renderInline(line.replace(/^[-*]\s+/, ''), `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }

        if (lines.length > 0 && lines.every((l) => /^\d+\.\s+/.test(l))) {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>{renderInline(line.replace(/^\d+\.\s+/, ''), `${key}-${i}`)}</li>
              ))}
            </ol>
          );
        }

        if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
          const headingText = lines[0].replace(/^#{1,6}\s+/, '');
          return (
            <p key={key} className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {renderInline(headingText, `${key}-h`)}
            </p>
          );
        }

        return <p key={key}>{renderInline(lines.join(' '), `${key}-p`)}</p>;
      })}
    </div>
  );
}
