import { AdminOverview } from '../../../features/admin/AdminOverview';
import { AgentFarmers } from '../../../features/agent/AgentFarmers';
import { DriverToday } from '../../../features/driver/DriverToday';
import { FarmerHome } from '../../../features/farmer/FarmerHome';
import { BuyerHome } from '../../../features/home/BuyerHome';
import { QaTasks } from '../../../features/qa/QaTasks';
import { SupplierHome } from '../../../features/supplier/SupplierHome';
import { useRole } from '../../../nav/Shell';

/** Home by role. */
export default function Home() {
  const role = useRole();
  if (role === 'farmer') return <FarmerHome />;
  if (role === 'qa_officer') return <QaTasks />;
  if (role === 'driver') return <DriverToday />;
  if (role === 'agent') return <AgentFarmers />;
  if (role === 'input_supplier') return <SupplierHome />;
  if (role === 'admin') return <AdminOverview />;
  // Buyers, households and anyone not yet set up see the shop.
  return <BuyerHome />;
}
