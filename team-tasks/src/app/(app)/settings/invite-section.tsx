"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

export function InviteSection({ inviteUrl, joinCode }: { inviteUrl: string; joinCode: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
        <code className="flex-1 truncate text-xs">{inviteUrl}</code>
        <Button type="button" variant="ghost" size="icon" onClick={copy}>
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Or share the join code directly: <code className="rounded border bg-muted px-1.5 py-0.5">{joinCode}</code>
      </p>
    </div>
  );
}
