import { avatarTone, initials } from "@/lib/shared/tokens";

/**
 * Ported from H.avatar / H.avatarStack, now with an optional uploaded image.
 *
 * Initials remain the default, not a fallback for a failed load: most of the
 * board has no login, and only a login can upload a picture. Colour is derived
 * from the id so a person keeps the same one everywhere and across reloads
 * without anything being stored.
 */

export interface AvatarPerson {
  id: string;
  name: string;
  /** From lib/db/queries/avatars.ts avatarUrl(). Carries a ?v= version, so it
   *  can be cached hard and still update the moment somebody re-uploads. */
  avatarUrl?: string | null;
}

export function Avatar({
  person,
  size = "h-8 w-8",
  online,
}: {
  person: AvatarPerson;
  size?: string;
  /** Presence dot. Undefined means "presence is not shown here" — which is
   *  different from "offline", and renders no dot at all. */
  online?: boolean;
}) {
  const badge =
    online === undefined ? null : (
      <span
        title={online ? "Online" : "Offline"}
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${
          online ? "bg-ok" : "bg-faintest"
        }`}
      />
    );

  return (
    <span className="relative inline-flex shrink-0">
      {person.avatarUrl ? (
        // A plain <img>, not next/image: these are already optimised to a
        // 256px WebP on the way in, and next/image would put its own loader in
        // front of an authenticated route for no benefit.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={person.avatarUrl}
          alt={person.name}
          title={person.name}
          loading="lazy"
          decoding="async"
          className={`${size} shrink-0 rounded-full object-cover ring-2 ring-surface`}
        />
      ) : (
        <span
          title={person.name}
          className={`grid ${size} shrink-0 place-items-center rounded-full text-[10px] font-bold ring-2 ring-surface ${avatarTone(
            person.id,
          )}`}
        >
          {initials(person.name)}
        </span>
      )}
      {badge}
    </span>
  );
}

/**
 * Faces AND names. The stack alone answers "how many", not "who": most of the
 * board has no uploaded picture, so the faces are initials that only mean
 * something to people who already know. A label that matched nobody in the
 * directory is said in amber, the same as the roster does.
 */
export function PeopleCell({
  people,
  max = 3,
  empty = "Unassigned",
}: {
  people: (AvatarPerson & { unmatched?: boolean })[];
  max?: number;
  empty?: string;
}) {
  if (!people.length) return <span className="text-xs text-faint">{empty}</span>;

  const names = people.slice(0, 2);
  const rest = people.length - names.length;
  const unmatched = people.some((person) => person.unmatched);

  return (
    <div className="flex min-w-0 items-center gap-2.5" title={people.map((person) => person.name).join(", ")}>
      <div className="flex shrink-0 -space-x-2">
        {people.slice(0, max).map((person) => (
          <Avatar key={person.id} person={person} size="h-7 w-7" />
        ))}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-ink-2">
          {names.map((person) => person.name).join(", ")}
          {rest > 0 ? <span className="font-medium text-faint"> +{rest}</span> : null}
        </p>
        {unmatched ? <p className="truncate text-[10px] text-warn">Name not in the directory</p> : null}
      </div>
    </div>
  );
}

export function AvatarStack({ people, max = 3 }: { people: AvatarPerson[]; max?: number }) {
  if (!people.length) return <span className="text-sm text-faintest">—</span>;

  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((person) => (
          <Avatar key={person.id} person={person} />
        ))}
      </div>
      {rest > 0 && <span className="ml-2.5 text-[11px] font-semibold text-faint">+{rest}</span>}
    </div>
  );
}
