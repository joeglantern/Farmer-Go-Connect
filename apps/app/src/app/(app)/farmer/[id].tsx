import { useLocalSearchParams } from 'expo-router';
import { FarmerProfileScreen } from '../../../features/buyer/FarmerProfileScreen';

export default function ScreenFarmer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FarmerProfileScreen id={id} />;
}
