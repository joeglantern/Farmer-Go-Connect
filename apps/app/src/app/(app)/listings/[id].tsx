import { useLocalSearchParams } from 'expo-router';
import { ListingDetail } from '../../../features/farmer/ListingDetail';

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ListingDetail id={id} />;
}
