import type { Locale } from '@/lib/i18n'

const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
]

export function formatDate(date: string | Date, locale = 'en-US') {
  return new Date(date).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatDateTime(date: string | Date, locale = 'en-US') {
  return new Date(date).toLocaleString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelativeTime(date: string | undefined, now: Date, locale: Locale) {
  if (!date) return ''

  const targetDate = new Date(date)

  if (Number.isNaN(targetDate.getTime())) {
    return ''
  }

  const diffMs = targetDate.getTime() - now.getTime()
  const absDiffMs = Math.abs(diffMs)
  const unit =
    RELATIVE_TIME_UNITS.find((candidate) => absDiffMs >= candidate.ms) ||
    RELATIVE_TIME_UNITS[RELATIVE_TIME_UNITS.length - 1]
  const value = Math.round(diffMs / unit.ms)
  const formatter = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    numeric: 'auto',
  })

  return formatter.format(value, unit.unit)
}
