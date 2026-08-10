import { Cockpit } from "@/components/Cockpit";

/**
 * Sector is one screen. Everything interactive lives inside the cockpit, which
 * is a client boundary because it owns the map.
 */
export default function Home() {
  return <Cockpit />;
}
