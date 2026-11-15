import { LabelBuilder, StringSelectMenuBuilder, type ModalSubmitInteraction } from 'discord.js';
import { DateTime } from 'luxon';
import { UserError, type TimeSpec } from '../core/types.js';

interface Option {
  label: string;
  value: string;
  default?: boolean;
}

const DAYS = 14;
const pad = (n: number): string => String(n).padStart(2, '0');

/** "As soon as possible" and "Flexible" (when `open`), then the next 14 days in the timezone. */
export function dayOptions(now: Date, timezone: string, open: boolean): Option[] {
  const options: Option[] = open
    ? [
        { label: 'As soon as possible', value: 'asap' },
        { label: 'Flexible (time to be agreed)', value: 'flexible' },
      ]
    : [];
  const today = DateTime.fromJSDate(now, { zone: timezone }).setLocale('en');
  for (let n = 0; n < DAYS; n++) {
    const day = today.plus({ days: n });
    const date = day.toFormat('ccc d LLL');
    const label = n === 0 ? `Today · ${date}` : n === 1 ? `Tomorrow · ${date}` : date;
    options.push({ label, value: day.toFormat('yyyy-MM-dd') });
  }
  return options;
}

/** 12:00 to 23:30 in 30-minute steps: the most a dropdown holds besides staying readable. */
export function halfHourOptions(): Option[] {
  const options: Option[] = [];
  for (let hour = 12; hour < 24; hour++) {
    for (const minute of [0, 30]) {
      const value = `${pad(hour)}:${pad(minute)}`;
      options.push({ label: value, value });
    }
  }
  return options;
}

/** The time for a day value of `dayOptions` and an "HH:mm" time. */
export function timeFromForm(day: string, time: string, timezone: string): TimeSpec {
  if (day === 'asap' || day === 'flexible') return { type: day };
  const at = DateTime.fromFormat(`${day} ${time}`, 'yyyy-MM-dd HH:mm', { zone: timezone });
  if (!at.isValid) throw new UserError('Pick the day and time from the lists.');
  return { type: 'at', at: at.toJSDate() };
}

const select = (id: string, options: Option[]): StringSelectMenuBuilder =>
  new StringSelectMenuBuilder().setCustomId(id).setRequired(true).addOptions(options);

const withDefault = (options: Option[], value: string | undefined): Option[] =>
  options.map((o) => (o.value === value ? { ...o, default: true } : o));

/** The Day dropdown; `open` adds "As soon as possible" (preselected) and "Flexible". */
export function dayField(now: Date, timezone: string, open: boolean): LabelBuilder {
  const options = withDefault(dayOptions(now, timezone, open), open ? 'asap' : undefined);
  return new LabelBuilder().setLabel('Day').setStringSelectMenuComponent(select('day', options));
}

const timeNote = (timezone: string, open: boolean): string =>
  `Server time (${timezone})${open ? '. Not used for "As soon as possible" and "Flexible".' : ''}`;

/** The Hour and Minutes dropdowns, preselected to 20:00. */
export function hourMinuteFields(timezone: string, open: boolean): LabelBuilder[] {
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${pad(h)}:00`, value: pad(h) }));
  const minutes = ['00', '15', '30', '45'].map((m) => ({ label: `:${m}`, value: m }));
  return [
    new LabelBuilder()
      .setLabel('Hour')
      .setDescription(timeNote(timezone, open))
      .setStringSelectMenuComponent(select('hour', withDefault(hours, '20'))),
    new LabelBuilder()
      .setLabel('Minutes')
      .setStringSelectMenuComponent(select('minute', withDefault(minutes, '00'))),
  ];
}

/** One Time dropdown in 30-minute steps, for forms with no room for two; preselected to 20:00. */
export function halfHourField(timezone: string, open: boolean): LabelBuilder {
  return new LabelBuilder()
    .setLabel('Time')
    .setDescription(timeNote(timezone, open))
    .setStringSelectMenuComponent(select('time', withDefault(halfHourOptions(), '20:00')));
}

/** Reads `day` with either `hour` and `minute` or `time` from a submitted form. */
export function readFormTime(
  i: ModalSubmitInteraction,
  timezone: string,
  fields: 'hourMinute' | 'halfHour',
): TimeSpec {
  const value = (id: string): string => i.fields.getStringSelectValues(id)[0] ?? '';
  const time = fields === 'halfHour' ? value('time') : `${value('hour')}:${value('minute')}`;
  return timeFromForm(value('day'), time, timezone);
}
