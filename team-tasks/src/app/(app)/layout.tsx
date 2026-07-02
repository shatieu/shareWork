import { requireUser, requireCurrentTeam } from "@/lib/team";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const { team, teams } = await requireCurrentTeam();
  const userLabel = user.email ?? "Signed in";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="md:h-screen md:sticky md:top-0">
        <AppNav teams={teams} currentTeam={team} userLabel={userLabel} />
      </div>
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
