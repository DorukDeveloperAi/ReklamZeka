import { OperatingDashboard } from "./operating-dashboard";
import { dashboardLocationFromSearch } from "./dashboard-location";

export default async function Dashboard({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const params = await searchParams;
  return <OperatingDashboard initialLocation={dashboardLocationFromSearch(params)} />;
}
