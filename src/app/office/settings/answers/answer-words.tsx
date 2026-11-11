import { tag } from "@/app/ui/classes";
import { wordParts } from "@/lib/office/answers-copy";

// An answer's words as the office reads them (Phase 35.3; the mock-up's): the words in a clear
// glass tile, each fill-in a chip with its name ("Next pay day"), so it's plain what comes from the
// firm's data. Hook-free: the list (a server page) and the form (a client one) both use it.
export function AnswerWords({ body }: { body: string }) {
  return (
    <p className="glass-tile rounded-row px-3 py-2 leading-8 break-words whitespace-pre-wrap">
      {wordParts(body).map((p, i) =>
        "fillIn" in p ? (
          <span key={i} className={`${tag} mx-1`} data-fill-in>
            {p.fillIn}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}
