import { redirect } from "next/navigation";
import { getMyTeams, requireUser } from "@/lib/team";
import { createTeam, joinTeam } from "@/app/actions/teams";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users, KeyRound } from "lucide-react";

export default async function OnboardingPage() {
  await requireUser();
  const teams = await getMyTeams();
  if (teams.length > 0) redirect("/");

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-8 p-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome to Team Tasks
        </h1>
        <p className="text-muted-foreground">
          Create a team to start defining work, or join one with a code.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
            <CardTitle>Create a team</CardTitle>
            <CardDescription>
              You&apos;ll be the owner and can invite teammates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={async (formData: FormData) => {
                "use server";
                await createTeam(formData);
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="name">Team name</Label>
                <Input id="name" name="name" required placeholder="Acme Engineering" />
              </div>
              <Button type="submit" className="w-full">
                Create team
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="size-5" />
            </div>
            <CardTitle>Join a team</CardTitle>
            <CardDescription>
              Paste the join code an admin shared with you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={async (formData: FormData) => {
                "use server";
                await joinTeam(formData);
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="code">Join code</Label>
                <Input id="code" name="code" required placeholder="a1b2c3d4e5f6" />
              </div>
              <Button type="submit" variant="outline" className="w-full">
                Join team
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
