'use client';

import { memo } from 'react';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  // Code blocks & inline code
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return (
        <div className="my-2 rounded-md border border-border/50 bg-[#07070c] overflow-x-auto">
          <div className="flex items-center justify-between border-b border-border/30 px-3 py-1">
            <span className="text-[10px] font-mono text-muted-foreground/60">
              {className?.replace('language-', '') ?? 'code'}
            </span>
          </div>
          <pre className="p-3 text-xs leading-relaxed overflow-x-auto">
            <code className={`${className ?? ''} text-foreground/90`} {...props}>
              {children}
            </code>
          </pre>
        </div>
      );
    }
    return (
      <code
        className="rounded-sm bg-muted border border-border/50 px-1.5 py-0.5 text-[0.85em] font-mono text-foreground/80"
        {...props}
      >
        {children}
      </code>
    );
  },
  // Block-level elements
  pre({ children }) {
    // Let the code component handle styling
    return <>{children}</>;
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
  },
  h1({ children }) {
    return <h1 className="mb-2 mt-3 first:mt-0 text-base font-bold text-foreground">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-3 first:mt-0 text-sm font-bold text-foreground">{children}</h2>;
  },
  h3({ children }) {
    return (
      <h3 className="mb-1.5 mt-2 first:mt-0 text-sm font-semibold text-foreground">{children}</h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="mb-1 mt-2 first:mt-0 text-sm font-medium text-foreground/90">{children}</h4>
    );
  },
  // Lists
  ul({ children }) {
    return (
      <ul className="mb-2 ml-4 list-disc space-y-0.5 marker:text-muted-foreground/50">
        {children}
      </ul>
    );
  },
  ol({ children }) {
    return (
      <ol className="mb-2 ml-4 list-decimal space-y-0.5 marker:text-muted-foreground/50">
        {children}
      </ol>
    );
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  // Block quotes
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-status-purple/40 pl-3 text-muted-foreground italic">
        {children}
      </blockquote>
    );
  },
  // Horizontal rule
  hr() {
    return <hr className="my-3 border-border/40" />;
  },
  // Links
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-status-purple underline underline-offset-2 decoration-status-purple/30 hover:text-status-purple/80 hover:decoration-status-purple/60 transition-colors"
      >
        {children}
      </a>
    );
  },
  // Bold / italic
  strong({ children }) {
    return <strong className="font-semibold text-foreground">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic text-foreground/80">{children}</em>;
  },
  // Tables (GFM)
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto rounded-md border border-border/40">
        <table className="w-full text-xs">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-border/40 bg-muted/30">{children}</thead>;
  },
  th({ children }) {
    return <th className="px-3 py-1.5 text-left font-medium text-foreground/80">{children}</th>;
  },
  td({ children }) {
    return <td className="px-3 py-1.5 border-t border-border/20">{children}</td>;
  },
};

const remarkPlugins = [remarkGfm];

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-content text-sm leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
