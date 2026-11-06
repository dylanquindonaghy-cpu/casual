import { Fragment } from "react";

// An email address that breaks only after its @ or a dot (28.11; the review's note 17: the address
// wrapped before its last letter, leaving "m)" alone on a line). Each piece up to and including an
// @ or a dot keeps together (so never mid-word, nor at a hyphen), with a break allowed between
// pieces. The words copy as the address itself. Hook-free: safe in server and client components.
export function EmailText({ email, className }: { email: string; className?: string }) {
  const pieces = email.split(/(?<=[@.])/);
  return (
    <span data-email="" className={className}>
      {pieces.map((piece, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          <span className="whitespace-nowrap">{piece}</span>
        </Fragment>
      ))}
    </span>
  );
}
