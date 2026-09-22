import type { ReactNode } from 'react';

// Tiny hand-written markdown renderer for Topic.context (docs/content-authoring.md §3):
// paragraphs, a single-line "# heading", "**bold**" / "*italic*" inline spans, and
// "- " bullet / "1. " numbered lists. Anything else is shown as plain text.

function renderInline(text: string, keyPrefix: string, strongClassName?: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-${i}`} className={strongClassName}>
          {match[1]}
        </strong>
      );
    } else {
      nodes.push(<em key={`${keyPrefix}-${i}`}>{match[2]}</em>);
    }
    lastIndex = pattern.lastIndex;
    i += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

interface MiniMarkdownProps {
  text: string;
  /** Replaces the default type scale of the wrapper (e.g. exercise bodies at 17px). */
  className?: string;
  /** Extra classes for **bold** spans, e.g. the highlight marker on a target word. */
  strongClassName?: string;
}

const DEFAULT_CLASS = 'flex flex-col gap-3 text-sm leading-relaxed text-text';

export function MiniMarkdown({
  text,
  className = DEFAULT_CLASS,
  strongClassName,
}: MiniMarkdownProps) {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className={className}>
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
                <li key={i}>
                  {renderInline(line.replace(/^[-*]\s+/, ''), `${key}-${i}`, strongClassName)}
                </li>
              ))}
            </ul>
          );
        }

        if (lines.length > 0 && lines.every((l) => /^\d+\.\s+/.test(l))) {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>
                  {renderInline(line.replace(/^\d+\.\s+/, ''), `${key}-${i}`, strongClassName)}
                </li>
              ))}
            </ol>
          );
        }

        if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
          const headingText = lines[0].replace(/^#{1,6}\s+/, '');
          return (
            <p key={key} className="text-base font-semibold text-text">
              {renderInline(headingText, `${key}-h`, strongClassName)}
            </p>
          );
        }

        return <p key={key}>{renderInline(lines.join(' '), `${key}-p`, strongClassName)}</p>;
      })}
    </div>
  );
}
