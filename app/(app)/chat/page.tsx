import { Icon } from "@/components/ui/Icon";

/** The empty pane, shown until a conversation is opened. */
export const metadata = { title: "Chat · Glophics Portal" };

export default function ChatIndexPage() {
  return (
    <div className="grid h-full place-items-center rounded-2xl bg-surface shadow-sm ring-1 ring-line">
      <div className="px-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-subtle-2 text-faint">
          <Icon name="chat" className="h-6 w-6" />
        </span>
        <p className="mt-4 text-sm font-semibold">Pick a conversation</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-faint">
          Or start a new one. Only people with a login can be messaged — most of the board is
          assignable to a claim without one.
        </p>
      </div>
    </div>
  );
}
