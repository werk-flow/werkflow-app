const TIME_TRACKING_TIME_ZONE = 'Europe/Berlin';

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
};

const zonedDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_TRACKING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_TRACKING_TIME_ZONE,
  timeZoneName: 'shortOffset',
  hour: '2-digit',
});

function getZonedDateParts(date: Date): ZonedDateParts {
  const parts = zonedDateFormatter.formatToParts(date);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(partMap.get('year')),
    month: Number(partMap.get('month')),
    day: Number(partMap.get('day')),
  };
}

function getTimeZoneOffsetMinutes(utcGuess: Date): number {
  const parts = offsetFormatter.formatToParts(utcGuess);
  const offsetValue =
    parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+0';
  const match = offsetValue.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!match) {
    return 0;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');

  return sign * (hours * 60 + minutes);
}

function getZonedDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number
): Date {
  const utcGuess = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess);

  return new Date(utcGuess.getTime() - offsetMinutes * 60 * 1000);
}

export function getLocalDayStart(date: Date): Date {
  const { year, month, day } = getZonedDateParts(date);
  return getZonedDateTime(year, month, day, 0, 0, 0, 0);
}

export function getLocalDayEnd(date: Date): Date {
  const { year, month, day } = getZonedDateParts(date);
  return getZonedDateTime(year, month, day, 23, 59, 59, 999);
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  const aParts = getZonedDateParts(a);
  const bParts = getZonedDateParts(b);

  return (
    aParts.year === bParts.year &&
    aParts.month === bParts.month &&
    aParts.day === bParts.day
  );
}

export function getLocalDayKey(date: Date): string {
  const { year, month, day } = getZonedDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
