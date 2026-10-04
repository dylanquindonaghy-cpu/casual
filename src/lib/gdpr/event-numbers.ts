// Event numbers come from one counter shared by every firm, so a file a firm downloads must not
// carry them: comparing two downloads would show how busy other firms had been in between (the
// reviews of Phase 10 task 19, audit L44). Each export numbers its own events 1, 2, 3… in the order
// they happened, and the event data that points at another event (`changeEventId`,
// `assignedEventId`) is pointed at the new number, or dropped when that event isn't in the file.

const pointsAtEvent = (key: string) => /EventId$/.test(key);

// Rows as an export reads them from events (an `id`, and `data`).
export function renumberEvents<T extends Record<string, unknown>>(rows: T[]): T[] {
  const order = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  const numberOf = new Map(order.map((row, i) => [Number(row.id), i + 1]));
  return rows.map((row) => {
    const data =
      row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? Object.fromEntries(
            Object.entries(row.data as Record<string, unknown>).flatMap(([key, value]) => {
              if (!pointsAtEvent(key)) return [[key, value]];
              const mapped = numberOf.get(Number(value));
              return mapped === undefined ? [] : [[key, mapped]];
            }),
          )
        : row.data;
    return { ...row, id: numberOf.get(Number(row.id)), data };
  });
}
