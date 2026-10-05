import { useLocalSearchParams } from 'expo-router';
import { RequirementFormScreen } from '../../../features/buyer/RequirementFormScreen';

/** New requirement, or edit one with ?id=. `produceId` preselects produce (from a product page). */
export default function ScreenRequirementForm() {
  const { id, produceId } = useLocalSearchParams<{ id?: string; produceId?: string }>();
  return <RequirementFormScreen id={id} produceId={produceId} />;
}
