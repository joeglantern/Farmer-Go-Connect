import { Redirect } from 'expo-router';
import { DriverHistory } from '../../../features/driver/DriverHistory';
import { QaHistory } from '../../../features/qa/QaHistory';
import { useRole } from '../../../nav/Shell';

/**
 * History by role: past inspections for QA officers, past routes for drivers. Every other
 * role keeps its history in Orders, so an old or typed link lands there instead.
 */
export default function ScreenHistory() {
  const role = useRole();
  if (role === 'qa_officer') return <QaHistory />;
  if (role === 'driver') return <DriverHistory />;
  return <Redirect href="/orders" />;
}
