"use client";

import { useActionState, useRef, useEffect } from "react";
import { createProject, type ProjectFormState } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";

const PROFILES: { value: string; label: string }[] = [
  { value: "nextjs-supabase-vercel", label: "Next.js + Supabase + Vercel" },
  { value: "python-service", label: "Python service" },
  { value: "minimal", label: "Minimal" },
];

const initialState: ProjectFormState = {};

export function ProjectForm() {
  const [state, formAction, pending] = useActionState(createProject, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required placeholder="marketing-site" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="repo_url">Repo URL</Label>
        <Input
          id="repo_url"
          name="repo_url"
          placeholder="https://github.com/acme/marketing-site"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="default_branch">Default branch</Label>
          <Input id="default_branch" name="default_branch" defaultValue="main" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup_profile">Setup profile</Label>
          <Select id="setup_profile" name="setup_profile" defaultValue={PROFILES[0].value}>
            {PROFILES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
        Add project
      </Button>
    </form>
  );
}
