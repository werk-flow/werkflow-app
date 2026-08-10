const BERLIN_TIME_ZONE = 'Europe/Berlin';

const BERLIN_DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function berlinParts(value: Date): DateTimeParts {
  const parts = new Map(
    BERLIN_DATE_TIME_FORMAT.formatToParts(value).map((part) => [
      part.type,
      part.value,
    ])
  );
  return {
    year: Number(parts.get('year')),
    month: Number(parts.get('month')),
    day: Number(parts.get('day')),
    hour: Number(parts.get('hour')),
    minute: Number(parts.get('minute')),
    second: Number(parts.get('second')),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatParts(parts: DateTimeParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatBerlinDateTimeInput(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return formatParts(berlinParts(date));
}

export function tomorrowMorningInBerlin(
  now: Date = new Date(),
  hour = 9
): string {
  const current = berlinParts(now);
  const tomorrow = new Date(
    Date.UTC(current.year, current.month - 1, current.day + 1)
  );
  return formatParts({
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate(),
    hour,
    minute: 0,
    second: 0,
  });
}

export function parseBerlinDateTimeInput(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const target: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  };
  const targetWallTime = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute
  );
  let candidateTime = targetWallTime;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rendered = berlinParts(new Date(candidateTime));
    const renderedWallTime = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute
    );
    const correction = targetWallTime - renderedWallTime;
    candidateTime += correction;
    if (correction === 0) break;
  }

  const candidate = new Date(candidateTime);
  return formatBerlinDateTimeInput(candidate) === value ? candidate : null;
}
