import Link from "next/link";
import { Fragment } from "react";
import { textLink } from "@/app/ui/classes";
import { MESSAGES_PATH } from "@/lib/portal/qualification-copy";

// Words with "message the office" made a link to her Messages (28.11; docs/screens.md "### 28.11"):
// "You can't take door supervisor shifts. Message the office." The link stays inside the sentence,
// in its words' own colour, underlined and semibold, and is 44px tall to tap (`min-h-11`) without
// moving the lines around it: its -10px margins above and below bring the room it takes back to a
// 24px line (16px words), and its words sit on the sentence's own baseline. Any other words stay
// text. Hook-free: safe in server and client components.

export const officeLinkClass = `${textLink} -my-2.5 inline-flex min-h-11 items-center font-semibold`;

export function OfficeLinked({ text }: { text: string }) {
  const parts = text.split(/(message the office)/i);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Link key={i} href={MESSAGES_PATH} className={officeLinkClass}>
            {part}
          </Link>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
