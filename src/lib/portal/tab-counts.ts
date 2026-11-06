import { inHand } from "./in-hand";
import { unreadReplies } from "./messages";
import { myNeedsAndPhoto, needsDoingCount, type PortalContext } from "./my-shifts";
import { mySortedMark } from "./profile";
import { unseenAnswerCounts } from "./request-answers";

// Every number the casual tab bar shows (Phase 28.2; 28.7 passes them to the TabBar on every
// casual page, so each tab has the same badge everywhere):
// - needs: things on Profile that need her (a qualification to sort out, her photo due), less a
//   qualification the office has in hand (Phase 28.15, 28.11's hand-off: inHand with the office's
//   latest "Mark as sorted", as Profile and Home's "Do this" read it);
// - answers: the office's answers to her requests she hasn't seen (Profile adds them to needs);
// - replies: the office's replies on Messages she hasn't seen;
// - payAnswers: payroll's answers to her pay queries she hasn't seen (the Pay tab; only that one
//   is there, never what it says).
// Her own rows only, each read inside her firm.

export interface TabCounts {
  needs: number;
  answers: number;
  replies: number;
  payAnswers: number;
}

async function needsToDo(ctx: PortalContext, workerId: string): Promise<number> {
  const [held, mark] = await Promise.all([
    myNeedsAndPhoto(ctx, workerId),
    mySortedMark(ctx, workerId),
  ]);
  return needsDoingCount({
    needs: held.needs.filter((n) => !inHand(n.qualification, mark)),
    photo: held.photo,
  });
}

export async function tabCounts(ctx: PortalContext, workerId: string): Promise<TabCounts> {
  const [needs, replies, unseen] = await Promise.all([
    needsToDo(ctx, workerId),
    unreadReplies(ctx, workerId),
    unseenAnswerCounts(ctx, workerId),
  ]);
  return { needs, answers: unseen.answers, replies, payAnswers: unseen.payAnswers };
}
