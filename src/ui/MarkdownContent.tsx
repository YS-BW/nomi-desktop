import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
}

function extractNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractNodeText).join("");
  }
  return "";
}

function CopyableCode(props: { children: ReactNode; className?: string }) {
  const { children, className } = props;
  const [copied, setCopied] = useState(false);
  const code = extractNodeText(children).replace(/\n$/, "");
  const isBlock = Boolean(className);
  const copyable = code.trim().length >= 18;

  async function copyCode() {
    if (!copyable || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  if (!copyable) {
    return <code className={className}>{children}</code>;
  }

  if (isBlock) {
    return (
      <span className="markdown-code-block">
        <button type="button" className="markdown-code-copy" onClick={copyCode}>
          {copied ? "已复制" : "复制"}
        </button>
        <code className={className}>{children}</code>
      </span>
    );
  }

  return (
    <span className="markdown-inline-code">
      <code>{children}</code>
      <button
        type="button"
        className="markdown-inline-code-copy"
        aria-label="复制代码"
        onClick={copyCode}
      >
        {copied ? "已复制" : "复制"}
      </button>
    </span>
  );
}

export function MarkdownContent(props: MarkdownContentProps) {
  const { content } = props;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        a: ({ node: _node, ...anchorProps }) => (
          <a {...anchorProps} target="_blank" rel="noreferrer" />
        ),
        code: ({ node: _node, className, children }) => (
          <CopyableCode className={className} children={children} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
