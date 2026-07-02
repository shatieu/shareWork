"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccessToken, revokeToken } from "@/app/actions/tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";
import { Copy, Loader2, Plus, Trash2, Check } from "lucide-react";
import type { AccessToken } from "@/lib/database.types";

export function TokenSection({
  tokens,
  appUrl,
}: {
  tokens: AccessToken[];
  appUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("Claude Code");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mcpUrl = `${appUrl}/api/mcp`;
  const connectCommand = newToken
    ? `claude mcp add --transport http team-tasks ${mcpUrl} --header "Authorization: Bearer ${newToken}"`
    : null;

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-2">
          <Label htmlFor="token-name">Token name</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Claude Code"
          />
        </div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await createAccessToken(name);
              if (result.token) setNewToken(result.token);
              router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Plus />}
          Generate
        </Button>
      </div>

      {connectCommand && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">
              Copy this now — the token won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
              <code className="flex-1 truncate text-xs">{connectCommand}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => copy(connectCommand)}
              >
                {copied ? <Check className="text-success" /> : <Copy />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Run this in your terminal to connect Claude Code to this team.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {tokens.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No tokens yet — generate one to connect Claude Code.
          </p>
        )}
        {tokens.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <div>
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                Created {timeAgo(t.created_at)}
                {t.last_used_at ? ` · last used ${timeAgo(t.last_used_at)}` : " · never used"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await revokeToken(t.id);
                  router.refresh();
                })
              }
            >
              <Trash2 className="text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
