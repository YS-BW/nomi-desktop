import { useEffect, useRef, useState } from "react";

import { MarkdownContent } from "./MarkdownContent";

const FRAME_DELAY_MS = 28;
const MIN_INITIAL_DELAY_MS = 36;

function computeChunkSize(remainingChars: number): number {
  if (remainingChars <= 0) {
    return 0;
  }
  if (remainingChars <= 24) {
    return 1;
  }
  if (remainingChars <= 80) {
    return 2;
  }
  return Math.max(3, Math.ceil(remainingChars / 14));
}

interface AnimatedMessageContentProps {
  content: string;
  animate: boolean;
}

export function AnimatedMessageContent(props: AnimatedMessageContentProps) {
  const { content, animate } = props;
  const [visibleLength, setVisibleLength] = useState(animate ? 0 : content.length);
  const visibleLengthRef = useRef(visibleLength);
  const lastContentRef = useRef(content);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    visibleLengthRef.current = visibleLength;
  }, [visibleLength]);

  useEffect(() => {
    if (!animate) {
      setVisibleLength(content.length);
      visibleLengthRef.current = content.length;
      lastContentRef.current = content;
      return;
    }

    const previousContent = lastContentRef.current;
    if (!content.startsWith(previousContent)) {
      setVisibleLength(0);
      visibleLengthRef.current = 0;
    }
    lastContentRef.current = content;
  }, [animate, content]);

  useEffect(() => {
    if (!animate) {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (visibleLengthRef.current >= content.length) {
      return;
    }

    const tick = () => {
      setVisibleLength((current) => {
        const remainingChars = content.length - current;
        if (remainingChars <= 0) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return current;
        }
        const nextLength = Math.min(content.length, current + computeChunkSize(remainingChars));
        visibleLengthRef.current = nextLength;
        if (nextLength >= content.length && timerRef.current !== null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return nextLength;
      });
    };

    const initialTimer = window.setTimeout(() => {
      tick();
      timerRef.current = window.setInterval(tick, FRAME_DELAY_MS);
    }, MIN_INITIAL_DELAY_MS);

    return () => {
      window.clearTimeout(initialTimer);
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [animate, content]);

  const visibleContent = animate ? content.slice(0, visibleLength) : content;

  return <MarkdownContent content={visibleContent} />;
}
