import { redirect } from "next/navigation";

/** Legacy fixture pilot is intentionally not a product surface. */
export default function PilotPage() {
  redirect("/dashboard");
}
