import { useLocalSearchParams } from 'expo-router';
import { RequirementDetailScreen } from '../../../features/buyer/RequirementDetailScreen';

export default function ScreenRequirement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RequirementDetailScreen id={id} />;
}
