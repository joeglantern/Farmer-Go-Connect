import { useTranslation } from 'react-i18next';
import { Pill, type Tone } from '../../ui/Controls';

const TONES: Record<string, Tone> = {
  OPEN: 'warning',
  PARTIALLY_FILLED: 'info',
  PAUSED: 'info',
  FILLED: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  DRAFT: 'neutral',
  ISSUED: 'warning',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  VOID: 'neutral',
};

/** Requirement and invoice status as text plus color. */
export function StatusTag({ status }: { status: string }) {
  const { t: tr } = useTranslation();
  return (
    <Pill
      label={tr(`requirements.status.${status}`, { defaultValue: status })}
      tone={TONES[status] ?? 'neutral'}
      size="sm"
    />
  );
}
