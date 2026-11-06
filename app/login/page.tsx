import { redirect } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { LoginForm } from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * The sign-in gate. Outside the (app) route group on purpose: pages in there
 * assume a shell around them, and there is no shell until someone is signed in.
 *
 * Ported from public/js/ui/login-screen.js — same two-panel layout, same copy.
 */
export const metadata = { title: "Sign in · Glophics Portal" };

/**
 * The left panel: what the tool is, in the tool's own vocabulary. A small
 * legend of the four states the board uses stands in for a hero illustration —
 * it is the first thing a new person needs to learn, and it is real.
 */
const STATES = [
  { dot: "bg-ok", label: "Free", text: "Nobody holds it. Claim it and deploy." },
  { dot: "bg-[#7be8c2]", label: "Partly free", text: "Some repositories are claimed, the rest are open." },
  { dot: "bg-warn", label: "In use", text: "Held by a Jira ticket until it is released." },
  { dot: "bg-bad", label: "Server down", text: "A repository failed its health check." },
];

function BrandPanel() {
  return (
    // A fixed dark green, not a theme token: this panel is the brand, and it
    // looks the same whichever theme the visitor last chose.
    <div className="relative hidden overflow-hidden border-r border-white/10 bg-[#04100b] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[#1fd396]/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-24 h-[28rem] w-[28rem] rounded-full bg-[#0f7a55]/30 blur-3xl" />
      <div className="relative flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-white/10 ring-1 ring-inset ring-white/15">
          <Icon name="servers" className="h-4 w-4" />
        </span>
        <span className="text-[15px] font-semibold">Glophics</span>
      </div>

      <div className="relative max-w-md">
        <h2 className="text-[26px] font-semibold leading-[1.2]">
          Know which environment is free before you deploy.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Every QA and staging box, who is holding it, and which ticket claimed it — live for the whole
          team.
        </p>

        <dl className="mt-10 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-4 backdrop-blur-md">
          {STATES.map((state) => (
            <div key={state.label} className="flex items-baseline gap-3 py-2.5">
              <dt className="flex w-28 shrink-0 items-center gap-2 text-[13px] font-medium">
                <span className={`h-2 w-2 rounded-full ${state.dot}`} />
                {state.label}
              </dt>
              <dd className="text-[13px] text-white/65">{state.text}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="relative text-xs text-white/50">Ask a super admin for an account.</p>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const { next, expired } = await searchParams;

  /**
   * The "you are already signed in" redirect lives here, not in middleware.
   *
   * Middleware can only see that a cookie exists. This resolves it, which is the
   * only check that can tell a live session from a dead one — and having both
   * redirect on different information is what caused an infinite /login ⇄
   * /dashboard loop. One authority decides.
   */
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="grid h-full lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel />
      <div className="flex items-center justify-center overflow-y-auto bg-panel px-6 py-12 sm:px-12">
        <LoginForm next={next} expired={expired === "1"} />
      </div>
    </div>
  );
}
