import React, { memo, useCallback } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import MarkdownReadonly from "../MarkdownReadonly";
import copy from "copy-to-clipboard";

export async function copyChatText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    if (!copy(text)) throw new Error("复制失败，请选择文字后复制。");
  }
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [feedback, setFeedback] = React.useState("复制代码");
  const copyCode = async () => {
    try {
      await copyChatText(code);
      setFeedback("已复制");
    } catch {
      setFeedback("复制失败");
    }
  };
  // Conservative highlighting; React text nodes always escape model-provided HTML.
  const parts =
    /^(js|javascript|ts|typescript|json|python|py|bash|sh|css|html)$/i.test(
      language,
    )
      ? code.split(
          /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:const|let|return|function|async|await|import|from|export|if|else|class|def|for|in|True|False|None|true|false|null)\b)/g,
        )
      : [code];
  return (
    <div className="text-chat-code">
      <div>
        <span>{language || "text"}</span>
        <button type="button" onClick={copyCode}>
          {feedback}
        </button>
      </div>
      <pre>
        <code>
          {parts.map((part, i) => (
            <span
              key={i}
              className={
                i % 2 ? (/^["']/.test(part) ? "string" : "keyword") : undefined
              }
            >
              {part}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function MathText({
  value,
  display = false,
}: {
  value: string;
  display?: boolean;
}) {
  const html = React.useMemo(() => {
    try {
      return katex.renderToString(value, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: "ignore",
        maxExpand: 500,
        maxSize: 20,
      });
    } catch {
      return null;
    }
  }, [value, display]);
  return html ? (
    <span
      className="text-chat-math"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <code>{value}</code>
  );
}
export const TextMarkdown = memo(function TextMarkdown({
  content,
}: {
  content: string;
}) {
  const codeBlock = useCallback(
    (code: string, language: string, key: string) =>
      language === "math" || language === "latex" ? (
        <MathText key={key} value={code} display />
      ) : (
        <CodeBlock key={key} code={code} language={language} />
      ),
    [],
  );
  const math = useCallback(
    (value: string, display: boolean, key: string) => (
      <MathText key={key} value={value} display={display} />
    ),
    [],
  );
  return (
    <MarkdownReadonly
      markdown={content}
      renderCodeBlock={codeBlock}
      renderMath={math}
    />
  );
});
