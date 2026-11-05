export function parseBudget(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const minutes = Number(value);
  if (!Number.isSafeInteger(minutes) || minutes <= 0)
    throw new Error("총시간은 1분 이상의 정수로 입력해 주세요.");
  return minutes;
}

export function todayInSeoul(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function availableSailings<T extends { departure: string }>(
  items: T[],
  now: Date,
): T[] {
  return items.filter(
    (item) =>
      Number.isFinite(Date.parse(item.departure)) &&
      Date.parse(item.departure) > now.getTime(),
  );
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
