"use client";

import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("md text-sm leading-relaxed", className)}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
