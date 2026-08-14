import { redirect } from "next/navigation";

/** Legacy fixture preview is intentionally not a product surface. */
export default function DemoReportPage() {
  redirect("/dashboard");
}
