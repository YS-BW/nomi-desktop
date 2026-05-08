import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
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
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
